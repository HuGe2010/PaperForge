import type { QuestionType } from './models';

/** 单个小题的编辑结构（审阅台 / 题库编辑共用） */
export interface SubQuestionOption {
  key: string;
  text: string;
  correct?: boolean;
}
export interface SubQuestionEdit {
  type: QuestionType | '';
  stem: string;
  options: SubQuestionOption[];
  answer?: string; // 简答/材料类参考答案
  images?: { cropId: string; label?: string }[]; // 小题题干题图
}

/**
 * 把编辑态的小题列表统一转成 content.subQuestions 结构。
 * 选择类：options 带 correct + 推导 answer（"A"/"AB"）；简答/材料类：保留 answer。
 * 有小题题型的才写 type（材料题小题无题型）。
 */
export function subQuestionsToContent(subs: SubQuestionEdit[]): any[] {
  return subs
    .filter((s) => s.stem.trim())
    .map((s) => {
      const isChoice = s.type === 'SINGLE_CHOICE' || s.type === 'MULTIPLE_CHOICE';
      const sq: Record<string, any> = { stem: s.stem };
      if (s.type) sq.type = s.type;
      if (isChoice) {
        sq.options = s.options.map((o) => ({ key: o.key, text: o.text, correct: !!o.correct }));
        const answer = optionsToAnswer(s.options);
        if (answer) sq.answer = answer;
      } else if (s.answer) {
        sq.answer = s.answer;
      }
      if (s.images?.length) {
        sq.images = s.images.map((i) => ({ cropId: i.cropId, label: i.label || '题内图片' }));
      }
      return sq;
    });
}

/** 从选项的 correct 布尔推导答案字符串（"A"/"AB"），无正确项返回空串 */
export function optionsToAnswer(options: { key: string; correct?: boolean }[]): string {
  return options.filter((o) => o.correct).map((o) => o.key).join('');
}
