import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  DetectInput,
  DetectResult,
  DetectedBox,
} from './vlm-provider.interface';

/**
 * OCR 框选客户端：把图片发给本地 Python OCR 服务（putout/ocr），
 * 由其用 PaddleOCR 两阶段（OCR 所有文字 → 题号正则分组 → 圈出单题框/标题框）
 * 生成题目框，再原样返回。
 *
 * 与 VlmService 的关系：
 *   - 框选题目（detect）走本服务，无需任何 AI 密钥，对任意试卷页可用；
 *   - AI 识题（recognize）仍走 VlmService 内的真实视觉模型。
 *
 * 图片传递方式：后端读取 imagePath（或 buffer）后，以 multipart 上传给 OCR 服务，
 * OCR 服务无状态、不落盘。
 */
@Injectable()
export class OcrDetectService {
  /** OCR 服务地址，默认同 docker-compose 内的 http://ocr:8000 */
  private readonly baseUrl =
    process.env.OCR_SERVICE_URL || 'http://localhost:8000';

  /** 单次请求超时（毫秒）：PaddleOCR 在 CPU 上处理整页可能需 10~30s */
  private readonly timeoutMs = 120_000;

  async detect(input: DetectInput): Promise<DetectResult> {
    // 1. 取得图片二进制
    let buffer: Buffer;
    let filename = 'page.jpg';
    if (input.buffer) {
      buffer = input.buffer;
    } else if (input.imagePath) {
      if (!fs.existsSync(input.imagePath)) {
        throw new BadRequestException(`图片不存在: ${input.imagePath}`);
      }
      buffer = fs.readFileSync(input.imagePath);
      filename = path.basename(input.imagePath) || 'page.jpg';
    } else {
      throw new BadRequestException('detect 需要 imagePath 或 buffer');
    }

    // 2. 构造 multipart（使用 Node 18+ 内置 FormData / Blob）
    const form = new FormData();
    // Buffer -> Uint8Array<ArrayBuffer>，满足 BlobPart 类型约束（运行时 Node 也接受）
    form.append('file', new Blob([Uint8Array.from(buffer)], { type: 'image/jpeg' }), filename);

    // 3. 调用 OCR 服务
    let resp: Response;
    try {
      resp = await fetch(`${this.baseUrl}/detect`, {
        method: 'POST',
        body: form,
        // Node 18+ AbortSignal.timeout
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e: any) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        throw new BadRequestException(
          `OCR 服务响应超时（>${this.timeoutMs / 1000}s），请稍后重试或检查 OCR 服务状态`,
        );
      }
      throw new BadRequestException(`无法连接 OCR 服务（${this.baseUrl}）：${e?.message || e}`);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new BadRequestException(
        `OCR 服务返回错误 ${resp.status}: ${errText.slice(0, 300)}`,
      );
    }

    const data: any = await resp.json();

    // 4. 映射为 DetectedBox[]（坐标已是 0-1 归一化），保留题号 number、大题标题 title。
    //    图片不绑定到题目：OCR 返回的（页面级或题框内的）图片区域统一收拢到顶层 pageFigures，
    //    落库到 IngestPage.figures，由人工在审阅台采用到任意题/小题。
    const pageFigures: NonNullable<DetectResult['pageFigures']> = [];
    const collectFigures = (raw: any) => {
      if (!Array.isArray(raw)) return;
      for (const f of raw) {
        if (!Array.isArray(f?.bbox) || f.bbox.length !== 4) continue;
        pageFigures.push({
          bbox: f.bbox as [number, number, number, number],
          label: typeof f.label === 'string' ? f.label : undefined,
        });
      }
    };
    collectFigures(data?.pageFigures);

    const boxes: DetectedBox[] = (data?.boxes || []).map((b: any) => {
      collectFigures(b?.figures);
      return {
        bbox: b.bbox as [number, number, number, number],
        type: b.type ?? undefined,
        confidence: typeof b.confidence === 'number' ? b.confidence : 0.9,
        number: typeof b.number === 'number' ? b.number : null,
        title: typeof b.title === 'string' ? b.title : null,
      };
    });

    return {
      model: data?.model || 'paddleocr-v1',
      paperName: data?.paperName,
      boxes,
      pageFigures,
      raw: JSON.stringify({ count: boxes.length, figures: pageFigures.length, sample: boxes.slice(0, 3) }),
    };
  }
}
