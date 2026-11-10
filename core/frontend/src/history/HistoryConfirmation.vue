<script setup lang="ts">
defineProps<{ detail: string; decide(accepted: boolean): void }>();
function connected(event: Event) { return (event.currentTarget as Node).isConnected; }
</script>
<template>
  <h2 id="history-delete-title">删除这轮历史记录？</h2>
  <p id="history-delete-detail">{{ detail }}</p>
  <p>删除后无法恢复，当前作答和草稿会保留。</p>
  <div class="dialog-actions">
    <button id="history-delete-cancel" autofocus @click="connected($event) && decide(false)">取消</button>
    <button id="history-delete-confirm" class="danger-button" @click="connected($event) && decide(true)">删除记录</button>
  </div>
</template>
