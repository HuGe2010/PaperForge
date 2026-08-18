<script setup lang="ts">
import { computed } from 'vue';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const props = withDefaults(
  defineProps<{
    /** 含 $...$ 或 $$...$$ 的文本；公式外的文本段会被安全转义 */
    value: string;
    inline?: boolean;
  }>(),
  { inline: true },
);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 关键修复：先按 $$...$$ / $...$ 切分，文本段做 HTML 转义（防注入 + 显示中文），
 * 数学段以【原始 LaTeX】送 KaTeX（绝不先转义，否则 < > & 会变成 &lt; &gt; &amp; 导致解析失败）。
 * 文本段内的换行转换为 <br>，让解析/长文可读。
 */
function renderTex(src: string): string {
  if (!src) return '';
  const parts: string[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) {
      parts.push(escapeHtml(src.slice(last, m.index)).replace(/\n/g, '<br>'));
    }
    const tex = (m[1] ?? m[2]) as string;
    const displayMode = !!m[1];
    try {
      parts.push(
        katex.renderToString(tex, {
          displayMode,
          throwOnError: false,
          strict: false,
        }),
      );
    } catch {
      // 解析失败时回退为转义后的原文，避免整段丢失
      parts.push(escapeHtml(m[0]));
    }
    last = re.lastIndex;
  }
  if (last < src.length) {
    parts.push(escapeHtml(src.slice(last)).replace(/\n/g, '<br>'));
  }
  return parts.join('');
}

const html = computed(() => renderTex(props.value || ''));
</script>

<template>
  <!-- KaTeX 输出为受信 SVG/MathML，内容已按段安全处理 -->
  <span class="math-text" v-html="html" />
</template>

<style scoped>
.math-text {
  font-size: inherit;
  line-height: 1.6;
  word-break: break-word;
}
.math-text :deep(.katex) {
  font-size: 1.05em;
}
.math-text :deep(.katex-display) {
  margin: 0.4em 0;
}
</style>
