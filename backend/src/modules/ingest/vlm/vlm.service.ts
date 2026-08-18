import { Injectable, BadRequestException } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';
import { MockVlmProvider } from './mock-vlm.provider';
import { RealVlmProvider } from './real-vlm.provider';
import { OcrDetectService } from './ocr-detect.service';
import { PaddleOcrVlProvider } from './paddleocr-vl.provider';
import {
  DetectInput,
  DetectResult,
  RecognizeInput,
  RecognizeResult,
  VLMProvider,
} from './vlm-provider.interface';

/**
 * VLM 调度服务：
 *   - 框选题目（detect）：改用本地 OCR 两阶段服务（OcrDetectService），无需任何
 *     AI 密钥，对任意试卷页可用，点击「AI 框选题目」即出框，不再走云端视觉模型。
 *   - AI 识题（recognize）：仍走真实视觉模型（按系统设置 `vlm` 组配置）。
 *
 * 说明：自 2025-08 起，默认不再静默回退到 Mock 假题——recognize 未配置真实密钥时
 * 直接报错，避免向题库写入编造的题目。仅当显式设置环境变量 ALLOW_MOCK_VLM=1 时，
 * 才允许本地无密钥演示。
 */
@Injectable()
export class VlmService {
  constructor(
    private readonly settings: SettingsService,
    private readonly ocrDetect: OcrDetectService,
  ) {}

  /**
   * 框选题目：根据系统设置「OCR 方案」在本地 OCR 与云端 PaddleOCR-VL 之间切换。
   * 默认本地（无需密钥）；切到云端后需在系统设置填写 API URL + Token。
   */
  async detect(input: DetectInput): Promise<DetectResult> {
    const cfg = await this.settings.getGroupDecrypted('ocr');
    const provider = (cfg.provider || 'local') as 'local' | 'cloud';
    if (provider === 'cloud') {
      const apiUrl = cfg.apiUrl || '';
      const token = cfg.token || '';
      if (!apiUrl || !token) {
        throw new BadRequestException('云端 OCR 未配置：请在「系统设置 → OCR 方案」填写 API URL 与 Token');
      }
      return new PaddleOcrVlProvider({ apiUrl, token, model: cfg.model || undefined }).detect(input);
    }
    return this.ocrDetect.detect(input);
  }

  /** AI 识题：仍走真实视觉模型（系统设置 → 视觉模型）。 */
  async recognize(input: RecognizeInput): Promise<RecognizeResult> {
    const provider = await this.buildProvider();
    return provider.recognize(input);
  }

  // ---- 以下仅服务于 recognize 的视觉模型选择 ----

  private async buildProvider(): Promise<VLMProvider> {
    const cfg = await this.settings.getGroupDecrypted('vlm');
    const useReal = cfg.enabled === 'true' && !!cfg.apiKey;
    if (useReal) {
      return new RealVlmProvider({
        apiKey: cfg.apiKey as string,
        baseUrl: cfg.baseUrl ?? undefined,
        model: cfg.model ?? undefined,
      });
    }
    if (process.env.ALLOW_MOCK_VLM === '1') {
      return new MockVlmProvider();
    }
    throw new BadRequestException(
      '未配置视觉模型密钥（系统设置 → 视觉模型）。请在「系统设置」填写阿里云 DashScope 的 API Key 后重试，系统不会编造题目。',
    );
  }
}
