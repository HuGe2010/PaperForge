<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';

const props = withDefaults(
  defineProps<{
    /** horizontal: 左右分栏; vertical: 上下分栏 */
    direction?: 'horizontal' | 'vertical';
    /** 首栏初始占比 (0-100) */
    defaultFirst?: number;
    /** 首栏最小占比 */
    minFirst?: number;
    /** 尾栏最小占比 */
    minSecond?: number;
  }>(),
  { direction: 'horizontal', defaultFirst: 50, minFirst: 20, minSecond: 20 },
);

const firstSize = ref(props.defaultFirst);
const containerRef = ref<HTMLElement | null>(null);
const dragging = ref(false);

const isHorizontal = computed(() => props.direction === 'horizontal');

function onPointerDown(e: PointerEvent) {
  dragging.value = true;
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value || !containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const pct = isHorizontal.value
    ? ((e.clientX - rect.left) / rect.width) * 100
    : ((e.clientY - rect.top) / rect.height) * 100;
  const clamped = Math.min(
    100 - props.minSecond,
    Math.max(props.minFirst, pct),
  );
  firstSize.value = clamped;
}
function onPointerUp() {
  dragging.value = false;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
}
onBeforeUnmount(onPointerUp);
</script>

<template>
  <div
    ref="containerRef"
    class="split-pane"
    :class="[`split-pane--${direction}`, { 'split-pane--dragging': dragging }]"
  >
    <div class="split-pane__first" :style="isHorizontal ? { width: firstSize + '%' } : { height: firstSize + '%' }">
      <slot name="first" />
    </div>
    <div class="split-pane__divider" @pointerdown="onPointerDown" role="separator" aria-orientation="horizontal">
      <span class="split-pane__handle" />
    </div>
    <div class="split-pane__second">
      <slot name="second" />
    </div>
  </div>
</template>

<style scoped>
.split-pane {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.split-pane--vertical { flex-direction: column; }
.split-pane__first { overflow: auto; min-width: 0; min-height: 0; }
.split-pane__second { flex: 1 1 auto; overflow: auto; min-width: 0; min-height: 0; }
.split-pane--vertical .split-pane__first { flex: 0 0 auto; }
.split-pane--horizontal .split-pane__first { flex: 0 0 auto; }

.split-pane__divider {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--c-border);
  position: relative;
  transition: background-color var(--motion-fast) var(--ease-out);
}
.split-pane--horizontal .split-pane__divider { width: 4px; cursor: col-resize; }
.split-pane--vertical .split-pane__divider { height: 4px; cursor: row-resize; }
.split-pane__divider:hover,
.split-pane--dragging .split-pane__divider { background: var(--c-primary); }

.split-pane__handle {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-pill);
  background: var(--c-surface);
  border: 1px solid var(--c-border-strong);
  box-shadow: var(--shadow-sm);
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
}
.split-pane--horizontal .split-pane__handle::before,
.split-pane--horizontal .split-pane__handle::after {
  content: '';
  width: 2px;
  height: 10px;
  background: var(--c-border-strong);
  margin: 0 1px;
}
.split-pane--vertical .split-pane__handle::before,
.split-pane--vertical .split-pane__handle::after {
  content: '';
  height: 2px;
  width: 10px;
  background: var(--c-border-strong);
  margin: 1px 0;
}
.split-pane--dragging { cursor: grabbing; user-select: none; }
</style>
