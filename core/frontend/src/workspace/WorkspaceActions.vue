<script setup lang="ts">
import type { WorkspaceModel, WorkspaceCommand } from './workspace';
defineProps<{ model: WorkspaceModel; run(command: WorkspaceCommand): void }>();
const connected = (event: Event) => (event.currentTarget as Node).isConnected;
</script>
<template>
  <button id="history-open" class="header-action" :hidden="model.historyHidden" :disabled="model.busy" title="历史记录" aria-label="历史记录" @click="connected($event) && run('history')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11a9 9 0 1 1 3 7M3 4v7h7M12 7v5l3 2" /></svg></button>
  <button id="edit-open" class="header-action" :hidden="model.editHidden" :disabled="model.busy" title="编辑本题" aria-label="编辑本题" @click="connected($event) && run('edit')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5-11 11H4v-5L15 4Zm-3 3 5 5" /></svg></button>
  <button id="development-publish-open" class="development-preview-return" hidden>发布正式版</button>
  <button id="development-edit" class="header-action" hidden title="预览编辑页面" aria-label="预览编辑页面"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5-11 11H4v-5L15 4Zm-3 3 5 5" /></svg></button>
  <button id="development-return" class="development-preview-return" hidden>返回样例</button>
  <button id="draft-toggle" class="draft-toggle" :hidden="model.draftHidden" :disabled="model.busy" :aria-pressed="model.drafting" @click="connected($event) && run('draft')"><span>✎</span>{{ ' ' + model.draftLabel }}</button>
</template>
