<template>
  <router-view />
</template>

<script setup lang="ts">
import { useTheme } from './composables/useTheme';

// 应用启动时按 localStorage 偏好设置 <html> 的 dark 类，整站亮暗一键切换
useTheme();
</script>
