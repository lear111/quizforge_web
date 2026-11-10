<script setup lang="ts">
import type { HistoryState } from './history';
defineProps<{ state: HistoryState; actions: { close(): void; open(id: string): Promise<void>; remove(id: string): Promise<void> } }>();
function connected(event: Event) { return (event.currentTarget as Node).isConnected; }
</script>
<template>
  <div class="dialog-heading">
    <h2 id="history-title">{{ state.title }}</h2>
    <button id="history-close" class="icon-button" aria-label="关闭历史记录" :disabled="state.busy" @click="connected($event) && actions.close()">×</button>
  </div>
  <p class="history-hint">练习和已完成的考试在这里统一管理，考试记录带有“考试”标记。打开后可逐题查看作答与保存的草稿。</p>
  <p id="history-error" class="history-error" role="alert" :hidden="!state.error">{{ state.error }}</p>
  <div id="history-list" class="history-list" :aria-busy="state.busy">
    <div v-for="row in state.rows" :key="row.id" class="history-list-item" :data-history-id="row.id">
      <button type="button" class="history-row" :disabled="state.busy" @click="connected($event) && actions.open(row.id)">
        <span class="history-row-body"><strong>{{ row.title }}<span v-if="row.exam" class="history-exam-badge">考试</span></strong><small>{{ row.progress }}</small></span>
        <span class="history-score">{{ row.score }}</span>
      </button>
      <button type="button" class="history-delete" title="删除记录" :aria-label="row.deleteLabel" :disabled="state.busy" @click="connected($event) && actions.remove(row.id)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg>
      </button>
    </div>
    <p v-if="!state.rows.length" class="list-empty">还没有历史记录。练习提交后或考试完成后，会在这里保存记录。</p>
  </div>
</template>
