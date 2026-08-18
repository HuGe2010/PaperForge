# 设计体系（P2 落地）

风格：**现代 SaaS 清爽风**（类 Linear / Notion），亮 / 暗双主题，全页面响应式。
设计令牌是**单一真相源**，暗色只换变量值不改结构；任何业务页面之前必须先遵循本节，否则等于重做。

---

## 1. 设计令牌（tokens）

唯一源：`frontend/src/styles/tokens.scss`。通过 CSS 变量对外暴露，亮色在 `:root`、暗色在 `html.dark` 覆盖同名变量。
**业务代码一律用 `var(--c-*)` / `var(--space-*)` / `var(--radius-*)`，禁止写死颜色与像素间距。**

### 1.1 颜色
| 变量 | 含义 | 亮色 | 暗色 |
|---|---|---|---|
| `--c-primary` / `--c-primary-600` | 主色（靛蓝基准） | `#4f46e5` | `#818cf8`（提亮） |
| `--c-primary-hover` / `-active` | 主色悬浮 / 按下 | `#6366f1` / `#4338ca` | `#818cf8` / `#a5b4fc` |
| `--c-success` / `-warning` / `-danger` / `-info` | 语义色 | 绿/琥珀/红/蓝 | 略提亮 |
| `--c-bg` | 页面背景 | `#f8fafc` | `#0b1120` |
| `--c-surface` / `-surface-2` | 卡片 / 次级表面 | `#fff` / `#f1f5f9` | `#121826` / `#1a2233` |
| `--c-text` / `-muted` / `-subtle` | 文本三级 | 深灰三级 | 浅灰三级（不用纯白） |
| `--c-border` / `-border-strong` | 边框两级 | 灰 200/300 | 深蓝灰 |

### 1.2 尺度
- **圆角**：`--radius-sm 8px`（控件）/ `--radius-md 12px`（卡片）/ `--radius-lg 16px`（弹窗）/ `--radius-pill 999px`
- **阴影**：仅 `--shadow-sm`、`--shadow-md` 两级，**禁用重阴影 / 渐变 / 发光**
- **间距**：4px 基准的 8 点网格 —— `--space-1..12`（4/8/12/16/20/24/32/40/48px）。组件内外边距只取这些档位
- **字体**：`--font-sans`（中文系统栈）/ `--font-mono`（等宽，用于分数线、分值、代码）
- **动效**：`--motion-fast 150ms`、`--motion-base 200ms`，缓动 `--ease-out: cubic-bezier(.16,1,.3,1)`；全局已尊重 `prefers-reduced-motion`

### 1.3 Element Plus 变量同步
`tokens.scss` 同时覆盖 `--el-color-primary`、`--el-bg-color`、`--el-text-color-*`、`--el-border-color*`、`--el-fill-color*`、`--el-border-radius-base` 等，使 EP 组件与整站主题一致。**改动主色只需改 `tokens.scss` 顶部的 `$primary-*` Sass 变量，EP 变量会自动跟随。**

---

## 2. 主题切换（亮 / 暗）

- 组合式 `frontend/src/composables/useTheme.ts`：基于 `@vueuse/core` 的 `useDark`，在 `<html>` 上切换 `dark` 类（与 EP 暗色要求一致），状态持久化到 localStorage。
- 应用启动：`App.vue` 的 `setup` 中调用一次 `useTheme()`，按用户上次偏好应用主题类，无残留。
- 切换按钮：登录页右上角、主框架顶栏右侧（`<component :is="isDark ? 'Sunny' : 'Moon'">`），调用 `toggleTheme()`。

```ts
const { isDark, toggleTheme } = useTheme();
toggleTheme(); // 一键亮暗切换
```

---

## 3. 响应式策略

断点（`frontend/src/composables/useBreakpoint.ts`，源自 Tailwind）：`sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536`。
三条硬规则（已在组件中落地）：

1. **表格 `<md`（<768）转卡片列表** → 统一用 `ResponsiveTable`（见 §4），桌面 `el-table`、移动端卡片，列配置完全一致。
2. **左右分栏 `<lg`（<1024）转上下堆叠 / Tab** → 用 `SplitPane`（可拖拽分栏，窄屏降级为堆叠）。
3. **侧边栏 `<md` 收成抽屉** → `DefaultLayout` 在窄屏隐藏 `el-aside`，改用 `el-drawer` 承载同一套菜单。

```ts
const { isMobile, isTablet, isDesktop, ltMd, ltLg } = useBreakpoint();
```

---

## 4. 基础组件库（全局注册，直接 `<组件名>` 使用）

| 组件 | 用途 | 关键 props |
|---|---|---|
| `EmptyState` | 空数据态 | `title` / `description` / `icon`(`inbox`/`search`/`doc`/`image`) / `#action` 插槽 |
| `SkeletonList` | 加载骨架（列表） | `rows` / `showAvatar` |
| `SplitPane` | 可拖拽分栏 | `direction`(`horizontal`/`vertical`) / `defaultFirst` / `#first` `#second` 插槽 |
| `FilterChips` | 可删除的筛选条件 | `filters:{key,label,value}[]` / `@remove` `@clear` |
| `ResponsiveTable` | 响应式表格 | `columns:{prop,label,slot?,hideOnCard?}[]` / `data` / `rowKey` / `loading` / `cardTitleKey` / 具名列插槽 / `#empty` |

组件内部样式全部使用 `var(--c-*)` + scoped，确保亮暗无缝切换。

---

## 5. 关键界面（规划）

- **登录页**：居中卡片 + 品牌留白 + 右上角主题切换，相对 `/api` 请求（axios 拦截器统一处理错误提示）。
- **主框架 `DefaultLayout`**：可折叠侧栏 + 面包屑顶栏 + 卡片化内容区 + 三角色菜单（按 `auth.roles` 过滤分组）+ 亮暗切换 + 移动端抽屉。
- **业务页**（P3 起）：题库列表（ResponsiveTable + FilterChips）、题目详情（识别文本 / 原图双 Tab）、审阅台（SplitPane 左图右文 + 键盘流）、组卷向导、试卷预览、学生答题页（移动优先）、批阅台、数据看板（ECharts 亮暗双主题，P10）。
- 图标：全部 `@element-plus/icons-vue` 已全局注册，使用 `<el-icon><Menu/></el-icon>` 或 `<component :is="'Menu'">`。
