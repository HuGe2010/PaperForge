import { reactive } from 'vue';

/**
 * 题库「按试卷 / 按作业本」浏览窗口的全局共享状态。
 * QuestionListView（按试卷/作业本 tab）与 QuestionDetailView（来源试卷标签）
 * 共用同一个窗口，保证"进入的是可关闭可返回的窗口"且体验一致。
 */
export interface PaperWindowState {
  visible: boolean;
  type: 'paper' | 'workbook';
  name: string;
  /** 试卷用：文件（录入任务）id，按 sourceFileId 过滤 */
  jobId?: string;
  /** 作业本用：作业本实体 id */
  workbookId?: string;
}

const state = reactive<PaperWindowState>({ visible: false, type: 'paper', name: '' });

export function usePaperWindow() {
  const open = (type: 'paper' | 'workbook', name: string, id?: string) => {
    state.type = type;
    state.name = name;
    if (type === 'workbook') {
      state.workbookId = id;
      state.jobId = undefined;
    } else {
      state.jobId = id;
      state.workbookId = undefined;
    }
    state.visible = true;
  };
  const close = () => {
    state.visible = false;
  };
  return { state, open, close };
}
