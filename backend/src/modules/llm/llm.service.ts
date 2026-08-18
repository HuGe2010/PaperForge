import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

/** 待解答的题目输入 */
export interface SolveInput {
  type?: string;
  stem: string;
  content?: Record<string, any>;
  difficulty?: number;
}

/** AI 解答结果 */
export interface SolveResult {
  /** 解析 / 思路 */
  analysis?: string;
  /** 完整解答 / 答题步骤 */
  solution?: string;
  /** 选择题 / 判断题答案（如 "A" / "AB" / "T"） */
  answer?: string;
  /** 填空题各空答案 */
  blanks?: string[];
  /** 阅读理解大题：各小题答案（index 从 1 起对应小题顺序） */
  subAnswers?: Array<{ index: number; answer?: string }>;
  /** 建议知识点名 */
  suggestedKnowledgePoints?: string[];
  model: string;
}

/**
 * 文本大模型服务：读取系统设置 `llm` 组（provider / baseUrl / apiKey / model），
 * 调用 OpenAI 兼容的 /v1/chat/completions 生成题目解析与解答。
 * 默认 baseUrl 指向阿里云 DashScope 兼容端点，模型默认 qwen-plus。
 * 未配置 apiKey 时返回 null（调用方跳过 AI 解答，不抛错）。
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(private readonly settings: SettingsService) {}

  async solve(input: SolveInput): Promise<SolveResult | null> {
    const cfg = await this.settings.getGroupDecrypted('llm');
    const apiKey = cfg.apiKey || null;
    if (!apiKey) {
      this.logger.warn('未配置 LLM 密钥（系统设置 → 文本模型），跳过 AI 解答');
      return null;
    }
    const baseUrl = cfg.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = cfg.model || 'qwen-plus';

    const prompt = this.buildPrompt(input);
    const startMs = Date.now();
    this.logger.log(`[LLM solve] 开始 type=${input.type} model=${model}`);
    const controller = new AbortController();
    // 与前端 solve 超时(180s)对齐，留出后端处理余量；超时后主动中断并返回友好错误
    const timer = setTimeout(() => controller.abort(), 170000);
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                '你是一名严谨的学科辅导老师。请基于题目给出正确的解析与完整解答。只输出 JSON，格式：' +
                '{"analysis":"解析/思路(可含 LaTeX $...$)","solution":"完整解答与步骤(可含 LaTeX)","suggestedKnowledgePoints":["知识点1","知识点2"]}。' +
                '答案要求（所有题型都要给出答案）：' +
                '选择题/判断题 → 额外字段 "answer"（选择如 "A" 或 "AB"，判断 "T"/"F"）；' +
                '填空题 → 额外字段 "blanks":["第一空答案","第二空答案",...]；' +
                '材料题/简答/论述（含多小问，如 (1)(2)(3)）→ 额外字段 "subAnswers":[{"index":1,"answer":"第1问参考答案"},...]，index 从 1 开始；单问则用 "answer":"参考答案"；' +
                '阅读理解大题 → 额外字段 "subAnswers":[{"index":1,"answer":"A"},{"index":2,"answer":"参考答案文字"}]，index 从 1 开始对应小题顺序，选择题小题 answer 为选项字母（单选如 "A"，多选如 "AB"），简答小题 answer 为参考答案文字。',
            },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        const msg = `文本模型调用失败(${resp.status}): ${errText.slice(0, 300)}`;
        this.logger.error(`[LLM solve] ${msg}`);
        throw new BadRequestException(msg);
      }
      const data: any = await resp.json();
      const text: string = data?.choices?.[0]?.message?.content || '{}';
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = {};
      }
      this.logger.log(`[LLM solve] 完成 耗时=${Date.now() - startMs}ms model=${model}`);
      return {
        analysis: typeof parsed?.analysis === 'string' ? parsed.analysis : undefined,
        solution: typeof parsed?.solution === 'string' ? parsed.solution : undefined,
        answer: typeof parsed?.answer === 'string' ? parsed.answer : undefined,
        blanks: Array.isArray(parsed?.blanks) ? parsed.blanks.map(String) : undefined,
        subAnswers: Array.isArray(parsed?.subAnswers)
          ? parsed.subAnswers
              .filter((x: any) => x && typeof x === 'object' && Number.isFinite(Number(x.index)))
              .map((x: any) => ({ index: Number(x.index), answer: typeof x.answer === 'string' ? x.answer : undefined }))
          : undefined,
        suggestedKnowledgePoints: Array.isArray(parsed?.suggestedKnowledgePoints)
          ? parsed.suggestedKnowledgePoints
          : [],
        model,
      };
    } catch (e) {
      // 主动中断(170s)或网络/解析异常：抛出明确错误，交由前端提示，避免静默吞成「超时」
      const isAbort = (e as any)?.name === 'AbortError' || (e as any)?.code === 'ABORT_ERR';
      const msg =
        e instanceof BadRequestException
          ? (e as BadRequestException).message
          : isAbort
            ? '文本模型响应超时（170 秒），请稍后重试，或到「系统设置 → 文本模型」更换更快的模型'
            : `LLM 解答异常: ${(e as Error).message}`;
      this.logger.error(`[LLM solve] ${msg} 耗时=${Date.now() - startMs}ms`);
      throw new BadRequestException(msg);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 判断新录入题目是否与候选题库题目「实质同一题」（题干+选项语义相同，答案/解析一致，忽略措辞/排版/题号差异）。
   * 返回匹配候选的 id，无匹配返回 null。未配置 LLM 密钥或调用失败时返回 null（跳过 AI 精判，交给粗筛阈值）。
   */
  /**
   * 批量文本向量化（查重语义层）：走 `llm` 组密钥 + OpenAI 兼容 /embeddings 端点。
   * 模型读 llm.embeddingModel（默认 qwen3.7-text-embedding），可独立于对话模型配置。
   * 未配置密钥返回 null（调用方跳过语义层，退回纯 Dice 词面匹配）。
   * 每次请求最多 batch 条，超长自动截断（embedding 对短文本足够）。
   */
  async embed(
    texts: string[],
    opts?: { batchSize?: number },
  ): Promise<{ model: string; vectors: number[][] } | null> {
    const clean = (texts || []).map((t) => (t || '').slice(0, 2000)).filter((t) => t.trim());
    if (!clean.length) return null;
    const cfg = await this.settings.getGroupDecrypted('llm');
    const apiKey = cfg.apiKey || null;
    if (!apiKey) {
      this.logger.warn('[LLM embed] 未配置 LLM 密钥，跳过语义向量');
      return null;
    }
    const baseUrl = cfg.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = cfg.embeddingModel || 'qwen3.7-text-embedding';
    const batchSize = opts?.batchSize ?? 10;

    const vectors: number[][] = [];
    for (let i = 0; i < clean.length; i += batchSize) {
      const chunk = clean.slice(i, i + batchSize);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const resp = await fetch(`${baseUrl}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, input: chunk }),
          signal: controller.signal,
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          this.logger.warn(`[LLM embed] 调用失败(${resp.status}): ${errText.slice(0, 200)}`);
          return null;
        }
        const data: any = await resp.json();
        const list: any[] = data?.data || [];
        // OpenAI 兼容格式按 index 对齐输入顺序
        const sorted = list
          .filter((x) => Array.isArray(x?.embedding))
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        if (sorted.length !== chunk.length) {
          this.logger.warn(`[LLM embed] 返回数量不匹配 expect=${chunk.length} got=${sorted.length}`);
          return null;
        }
        for (const x of sorted) vectors.push(x.embedding.map(Number));
      } catch (e) {
        const isAbort = (e as any)?.name === 'AbortError';
        this.logger.warn(`[LLM embed] 异常${isAbort ? '(超时)' : ''}: ${(e as Error).message}`);
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return { model, vectors };
  }

  async judgeDuplicate(
    newQ: { type: string; stem: string; content?: Record<string, any> },
    candidates: { id: string; stem: string; content?: any; solution?: string | null }[],
  ): Promise<string | null> {
    if (!candidates.length) return null;
    const cfg = await this.settings.getGroupDecrypted('llm');
    const apiKey = cfg.apiKey || null;
    if (!apiKey) return null;
    const baseUrl = cfg.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = cfg.model || 'qwen-plus';

    const newText = JSON.stringify({ type: newQ.type, stem: newQ.stem, content: newQ.content });
    const candText = candidates
      .map((c, i) => `[${i + 1}] ${JSON.stringify({ stem: c.stem, content: c.content })}`)
      .join('\n');

    const prompt =
      '下面是一道新录入的题目和若干候选题库题目，判断新题是否与某个候选「实质同一题」（题干语义与选项相同、答案/解析一致；忽略措辞、排版、题号差异）。\n' +
      `新题目：${newText}\n\n候选题：\n${candText}\n\n` +
      '只输出 JSON：{"match":true,"index":匹配的候选序号(1..N)} 或 {"match":false}。';

    const startMs = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是一名严谨的题目查重助手。只输出 JSON，不要任何解释。' },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        this.logger.warn(`[LLM judgeDuplicate] 调用失败 ${resp.status}`);
        return null;
      }
      const data: any = await resp.json();
      const text: string = data?.choices?.[0]?.message?.content || '{}';
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = {};
      }
      if (parsed?.match === true && Number.isFinite(Number(parsed?.index))) {
        const idx = Number(parsed.index);
        const cand = candidates[idx - 1];
        if (cand) {
          this.logger.log(`[LLM judgeDuplicate] 命中候选 index=${idx} 耗时=${Date.now() - startMs}ms`);
          return cand.id;
        }
      }
      return null;
    } catch (e) {
      this.logger.warn(`[LLM judgeDuplicate] 异常: ${(e as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildPrompt(input: SolveInput): string {
    const typeLabel: Record<string, string> = {
      SINGLE_CHOICE: '单选题',
      MULTIPLE_CHOICE: '多选题',
      TRUE_FALSE: '判断题',
      FILL_BLANK: '填空题',
      SHORT_ANSWER: '简答题',
      ESSAY: '论述题',
      MATERIAL: '材料题',
      READING_COMPREHENSION: '阅读理解',
    };
    const type = input.type ? typeLabel[input.type] || input.type : '未知题型';
    let contentStr = '';
    try {
      if (input.content) contentStr = '\n题目附加内容(JSON): ' + JSON.stringify(input.content);
    } catch {
      /* ignore */
    }
    // 分值：大题分值(content.score) 或各小题分值(subQuestions[].score)，供模型按分值给出得分点
    const score = (input.content as any)?.score;
    let scoreStr = '';
    const subs = Array.isArray((input.content as any)?.subQuestions) ? (input.content as any).subQuestions : [];
    if (typeof score === 'number' && Number.isFinite(score)) {
      scoreStr += `\n本题分值为 ${score} 分，请按分值合理给出得分点。`;
    }
    if (subs.length && subs.some((s: any) => typeof s?.score === 'number')) {
      scoreStr += `\n各小题分值：${subs.map((s: any, i: number) => `第${i + 1}问 ${s?.score ?? '?'} 分`).join('，')}。请按各小题分值分配得分点。`;
    }
    return `题型：${type}\n题干：${input.stem || ''}${contentStr}${scoreStr}\n难度：${input.difficulty ?? '未知'}/5\n请解答。`;
  }
}
