<script setup lang="ts">
defineProps<{ message: string; close(): void }>();
function connected(event: Event) { return (event.currentTarget as Node).isConnected; }
</script>
<template>
  <h2 id="editor-leave-title">请先处理当前编辑</h2>
  <p id="editor-leave-message">{{ message }}</p>
  <div class="dialog-actions"><button id="editor-leave-return" type="button" autofocus @click="connected($event) && close()">返回编辑</button></div>
</template>
