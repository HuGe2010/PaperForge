<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 骨架行数 */
    rows?: number;
    /** 是否显示首列头像占位 */
    showAvatar?: boolean;
  }>(),
  { rows: 6, showAvatar: false },
);
</script>

<template>
  <div class="skeleton-list" :class="{ 'skeleton-list--avatar': showAvatar }" aria-busy="true">
    <div v-for="i in rows" :key="i" class="skeleton-list__row">
      <div v-if="showAvatar" class="skeleton-list__avatar shimmer" />
      <div class="skeleton-list__body">
        <div class="skeleton-list__line shimmer" style="width: 60%" />
        <div class="skeleton-list__line shimmer" style="width: 90%" />
        <div class="skeleton-list__line shimmer" style="width: 45%" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}
.skeleton-list__row {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
}
.skeleton-list__avatar {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-pill);
  flex: 0 0 auto;
}
.skeleton-list__body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.skeleton-list__line {
  height: 12px;
  border-radius: 6px;
}
.shimmer {
  background: linear-gradient(
    90deg,
    var(--c-surface-2) 25%,
    var(--c-border) 37%,
    var(--c-surface-2) 63%
  );
  background-size: 400% 100%;
  animation: shimmer 1.4s ease infinite;
}
@keyframes shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .shimmer { animation: none; }
}
</style>
