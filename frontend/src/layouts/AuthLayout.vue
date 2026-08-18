<template>
  <div class="auth-layout">
    <slot />
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.auth-layout {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--c-bg);
  padding: 24px;
}
</style>
