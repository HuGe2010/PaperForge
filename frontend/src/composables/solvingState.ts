import { reactive } from 'vue';

// 跨组件实例共享：记录每道题是否正在后台生成 AI 解答。
// 放在模块级，使退出题目详情再进入时仍能读到「上次解答是否仍在进行」，
// 从而避免重复点击触发多次后台解答（解答请求是同步阻塞的 HTTP 调用，
// 组件卸载不会取消它，因此必须用持久化的标志位来防重复）。
export const solvingQuestions = reactive<Record<string, boolean>>({});
