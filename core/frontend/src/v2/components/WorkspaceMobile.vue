<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useUiStore } from '../stores/ui';
import { usePracticeStore } from '../stores/practice';
const { drawer } = storeToRefs(useUiStore());
const { overview } = storeToRefs(usePracticeStore());
function toggle(panel: 'library' | 'outline') {
  drawer.value = drawer.value === panel ? null : panel;
}
</script>
<template>
  <header class="v2-mobile">
    <button
      :aria-expanded="drawer === 'library'"
      aria-controls="v2-library"
      @click="toggle('library')"
    >
      题库
    </button>
    <strong>{{ overview?.bank.title ?? 'QuizForge' }}</strong>
    <button
      :aria-expanded="drawer === 'outline'"
      aria-controls="v2-outline"
      @click="toggle('outline')"
    >
      大纲
    </button>
  </header>
</template>
<style scoped>
.v2-mobile {
  display: none;
}
@media (max-width: 900px) {
  .v2-mobile {
    display: flex;
    flex: none;
    height: 56px;
    background: var(--qf-surface);
    z-index: 30;
    align-items: center;
    padding: 0 12px;
    gap: 8px;
    border-bottom: 1px solid var(--qf-border);
  }
  .v2-mobile button {
    flex: none;
    height: 40px;
    padding: 0 12px;
  }
  strong {
    flex: 1;
    min-width: 0;
    text-align: center;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
