import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import 'element-plus/dist/index.css';
import 'virtual:uno.css';
import './styles/tokens.scss';
import App from './App.vue';
import router from './router';

import EmptyState from './components/base/EmptyState.vue';
import SkeletonList from './components/base/SkeletonList.vue';
import SplitPane from './components/base/SplitPane.vue';
import FilterChips from './components/base/FilterChips.vue';
import ResponsiveTable from './components/base/ResponsiveTable.vue';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(ElementPlus);

// 基础组件库全局注册
app.component('EmptyState', EmptyState);
app.component('SkeletonList', SkeletonList);
app.component('SplitPane', SplitPane);
app.component('FilterChips', FilterChips);
app.component('ResponsiveTable', ResponsiveTable);

// Element Plus 图标全局注册（<el-icon><Menu/></el-icon> 或 <component :is="iconName"/>）
for (const [name, comp] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, comp);
}

app.mount('#app');
