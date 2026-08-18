import { defineConfig, presetUno, presetIcons } from 'unocss';

// 原子类预设。所有颜色/圆角/阴影统一引用 tokens.scss 里的 CSS 变量，
// 保证 UnoCSS 与设计令牌同源，亮暗切换无残留。
export default defineConfig({
  presets: [
    presetUno(),
    presetIcons({ scale: 1.1 }),
  ],
  theme: {
    colors: {
      // 引用 CSS 变量，亮暗自动跟随
      primary: 'var(--c-primary)',
      'primary-hover': 'var(--c-primary-hover)',
      'primary-active': 'var(--c-primary-active)',
      success: 'var(--c-success)',
      warning: 'var(--c-warning)',
      danger: 'var(--c-danger)',
      info: 'var(--c-info)',
      bg: 'var(--c-bg)',
      surface: 'var(--c-surface)',
      'surface-2': 'var(--c-surface-2)',
      text: 'var(--c-text)',
      'text-muted': 'var(--c-text-muted)',
      'text-subtle': 'var(--c-text-subtle)',
      border: 'var(--c-border)',
      'border-strong': 'var(--c-border-strong)',
    },
    borderRadius: {
      sm: 'var(--radius-sm)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
    },
    boxShadow: {
      sm: 'var(--shadow-sm)',
      md: 'var(--shadow-md)',
    },
    fontFamily: {
      sans: 'var(--font-sans)',
      mono: 'var(--font-mono)',
    },
  },
  shortcuts: {
    // 常用组合
    'card': 'bg-surface rounded-md shadow-sm border border-border',
    'flex-center': 'flex items-center justify-center',
    'btn-reset': 'border-0 bg-transparent cursor-pointer',
  },
});
