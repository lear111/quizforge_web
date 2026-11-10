<script setup lang="ts">
import type { EditorCommand, EditorModel } from './editor';
defineProps<{ model: EditorModel; run(command: EditorCommand): Promise<void> }>();
function connected(event: Event) { return (event.currentTarget as Node).isConnected; }
</script>
<template>
  <span id="mode-label">{{ model.label }}</span>
  <div>
    <button id="history-choose" :hidden="!model.history || !model.choose" :disabled="model.busy" @click="connected($event) && run('choose')">选择记录</button>
    <button id="return-practice" :hidden="!model.history" :disabled="model.busy" @click="connected($event) && run('return')">返回作答</button>
    <button id="edit-cancel" :hidden="!model.editing" :disabled="model.busy" @click="connected($event) && run('cancel')">取消编辑</button>
    <button id="edit-save" :hidden="!model.editing" :disabled="model.busy" @click="connected($event) && run('save')">保存本题</button>
  </div>
</template>
