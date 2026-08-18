import { useDark, useToggle } from '@vueuse/core';

/**
 * 主题：亮/暗双主题，持久化到 localStorage（跟随 @vueuse 默认 scheme key）。
 * useDark 默认在 <html> 上切换 `dark` 类 —— 与 Element Plus 暗色 css-vars
 * 要求的 `html.dark` 一致，故整站亮暗可一键切换且无残留。
 */
export function useTheme() {
  const isDark = useDark({
    selector: 'html',
    attribute: 'class',
    valueDark: 'dark',
    valueLight: '',
  });
  const toggleTheme = useToggle(isDark);

  return { isDark, toggleTheme };
}
