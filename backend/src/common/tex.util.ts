/**
 * LaTeX / 公式文本归一化工具。
 *
 * 问题背景：真实视觉模型有时会把数学表达式直接输出成裸 LaTeX（不带 `$...$` 定界符），
 * 或把 `<` `>` 写成 HTML 实体 `&lt;` `&gt;`。前端 KaTeX 只渲染 `$...$` 包裹的内容，
 * 且数学段若被 HTML 转义会变成非法 LaTeX。本工具在入库前把文本修成可渲染形态：
 *   1. 解码常见 HTML 实体（&gt; &lt; &amp; &quot; &#39; &nbsp;）；
 *   2. 若已含 `$` 定界符则信任、原样返回（避免重复包装）；
 *   3. 否则把「数学字符连续段」（含 \ 命令、^ _ 上下标、或 字母/数字 运算符 字母/数字 算式模式）
 *      包成 `$...$`，并保护 \text{...} 等含中文的数学组不被中文边界切断。
 */

function decodeEntities(s: string): string {
  return s
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&'); // 放最后，避免 &amp;gt; 被二次错误解码
}

function hasMathTrigger(run: string): boolean {
  if (run.includes('§')) return true; // 占位符代表 LaTeX 命令
  if (/\\/.test(run)) return true; // \frac \left \text ...
  if (/[_^]/.test(run)) return true; // 上标/下标
  return /[A-Za-z0-9)\]]\s*[=<>≤≥≠≈±×÷·]\s*[A-Za-z0-9(\[]/.test(run);
}

// 数学允许的字符（含占位符 § 与中文边界外的标点/运算符）。注意 `-` 放在类末尾以避免被当作区间符。
const MATH_CLASS =
  '[A-Za-z0-9\\s_^\\\\{}\\[\\]().|+*/=<>≤≥≠≈±×÷·,:;%@#§-]';
const MATH_RE = new RegExp(MATH_CLASS + '+', 'g');

const PROTECT_RE = /\\[a-zA-Z]+\{[^}]*\}/g;
const RESTORE_RE = /§(\d+)§/g;

/**
 * 给文本补上公式定界符并解码 HTML 实体。
 * 输入通常为单道题干 / 选项 / 解析等；已是 `$...$` 定界的内容会原样返回。
 * 接受 undefined / null（手动编辑场景字段可能为空），统一回退为空串。
 */
export function ensureMathDelimiters(input: string | null | undefined): string {
  if (input == null) return '';
  if (typeof input !== 'string') return '';
  let s = decodeEntities(input);
  if (s.includes('$')) return s; // 已定界，信任模型输出

  // 保护 \text{...} 等含中文的数学组，避免被中文边界切断
  const protectedCmds: string[] = [];
  s = s.replace(PROTECT_RE, (full) => {
    const ph = `§${protectedCmds.length}§`;
    protectedCmds.push(full);
    return ph;
  });

  s = s.replace(MATH_RE, (run) => {
    if (!run.trim()) return run;
    if (!hasMathTrigger(run)) return run;
    return `$${run.trim()}$`;
  });

  // 还原被保护的数学命令
  s = s.replace(RESTORE_RE, (_, i) => protectedCmds[Number(i)] ?? '');
  return s;
}
