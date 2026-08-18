import { QuestionType } from '@prisma/client';
import {
  BBox,
  DetectInput,
  DetectResult,
  DetectedBox,
  DetectedQuestion,
  RecognizeInput,
  RecognizeResult,
  VLMProvider,
} from './vlm-provider.interface';

/**
 * 本地 Mock 提供方：仅用于显式设置 ALLOW_MOCK_VLM=1 时的离线开发演示，
 * 不依赖任何外部密钥，返回确定性的示例题目/框。生产录入必须使用真实视觉模型。
 */
export class MockVlmProvider implements VLMProvider {
  readonly name = 'mock';

  async detect(_input: DetectInput): Promise<DetectResult> {
    const boxes: DetectedBox[] = [
      { bbox: [0.05, 0.05, 0.95, 0.28] as BBox, type: QuestionType.SINGLE_CHOICE, confidence: 0.9 },
      { bbox: [0.05, 0.30, 0.95, 0.52] as BBox, type: QuestionType.FILL_BLANK, confidence: 0.85 },
      { bbox: [0.05, 0.54, 0.95, 0.95] as BBox, type: QuestionType.READING_COMPREHENSION, confidence: 0.88 },
    ];
    // 页面级图片区域（与题目框解耦，落库到 IngestPage.figures）
    const pageFigures: Array<{ bbox: BBox; label?: string }> = [];
    return { model: 'mock-vlm', paperName: '示例试卷（Mock）', boxes, pageFigures };
  }

  async recognize(_input: RecognizeInput): Promise<RecognizeResult> {
    const items: DetectedQuestion[] = [
      {
        type: QuestionType.SINGLE_CHOICE,
        stem: '设函数 $f(x)=x^2$，则 $f\'(1)$ 的值为（  ）',
        content: {
          options: [
            { key: 'A', text: '$1$', correct: false },
            { key: 'B', text: '$2$', correct: true },
            { key: 'C', text: '$0$', correct: false },
            { key: 'D', text: '$-1$', correct: false },
          ],
        },
        analysis: '由 $f\'(x)=2x$ 得 $f\'(1)=2$，故选 B。',
        difficulty: 2,
        subject: '数学',
        confidence: 0.92,
        suggestedKnowledgePoints: ['导数', '二次函数'],
        suggestedTags: ['期末', '基础'],
      },
      {
        type: QuestionType.FILL_BLANK,
        stem: '若 $\\triangle ABC$ 中 $\\angle A = 60^\\circ$，且 $AB=AC$，则 $\\angle B = \\underline{\\quad}$。',
        content: { blanks: ['60°'] },
        analysis: '等腰三角形两底角相等，$\\angle B=\\angle C=(180^\\circ-60^\\circ)/2=60^\\circ$。',
        difficulty: 3,
        subject: '数学',
        confidence: 0.88,
        suggestedKnowledgePoints: ['等腰三角形', '三角形内角和'],
        suggestedTags: ['填空'],
      },
      {
        type: QuestionType.READING_COMPREHENSION,
        stem: '阅读下面的短文，回答问题。',
        content: {
          passage:
            'Tom went to the library yesterday. He borrowed two books about science and read them carefully. He thinks reading is very important.',
          subQuestions: [
            {
              type: QuestionType.SINGLE_CHOICE,
              stem: 'Where did Tom go yesterday?',
              options: [
                { key: 'A', text: 'The library' },
                { key: 'B', text: 'The park' },
                { key: 'C', text: 'The school' },
              ],
            },
            {
              type: QuestionType.SHORT_ANSWER,
              stem: 'Why does Tom think reading is important?',
            },
          ],
        },
        difficulty: 2,
        subject: '英语',
        confidence: 0.9,
        suggestedKnowledgePoints: ['阅读理解', '细节理解'],
        suggestedTags: ['英语', '阅读'],
      },
    ];
    return { model: 'mock-vlm', items };
  }
}
