<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useUiStore } from '../stores/ui';
const { drawer } = storeToRefs(useUiStore());
function toggle(panel: 'library' | 'outline') {
  drawer.value = drawer.value === panel ? null : panel;
}
</script>
<template>
  <header class="v2-mobile">
    <strong>QuizForge</strong>
    <button @click="toggle('library')">题库</button>
    <button @click="toggle('outline')">大纲</button>
  </header>
</template>
<style scoped>
.v2-mobile {
  display: none;
}
@media (max-width: 800px) {
  .v2-mobile {
    display: flex;
    position: fixed;
    inset: 0 0 auto;
    height: 56px;
    background: white;
    z-index: 5;
    align-items: center;
    padding: 8px 16px;
    gap: 12px;
    border-bottom: 1px solid #e6e3ee;
  }
  strong {
    margin-right: auto;
  }
}
</style>
