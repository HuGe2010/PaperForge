import { computed } from 'vue';
import { useWindowSize } from '@vueuse/core';

/**
 * 响应式断点（与计划一致）：
 *   sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536
 *
 * 三条硬规则依赖的判定：
 *  - ltMd  (<768) ：表格转卡片、侧栏收抽屉
 *  - ltLg  (<1024)：左右分栏转堆叠/Tab
 */
const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type BreakpointName = keyof typeof BREAKPOINTS;

export function useBreakpoint() {
  const { width } = useWindowSize();

  const current = computed<BreakpointName>(() => {
    if (width.value >= BREAKPOINTS['2xl']) return '2xl';
    if (width.value >= BREAKPOINTS.xl) return 'xl';
    if (width.value >= BREAKPOINTS.lg) return 'lg';
    if (width.value >= BREAKPOINTS.md) return 'md';
    if (width.value >= BREAKPOINTS.sm) return 'sm';
    return 'sm';
  });

  const ltMd = computed(() => width.value < BREAKPOINTS.md);
  const ltLg = computed(() => width.value < BREAKPOINTS.lg);
  const isMobile = computed(() => width.value < BREAKPOINTS.md);
  const isTablet = computed(
    () => width.value >= BREAKPOINTS.md && width.value < BREAKPOINTS.lg,
  );
  const isDesktop = computed(() => width.value >= BREAKPOINTS.lg);

  return { width, current, ltMd, ltLg, isMobile, isTablet, isDesktop };
}
