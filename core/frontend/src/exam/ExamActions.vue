<script setup lang="ts">
import type { ExamModel, ExamActions } from './exam';
defineProps<{ model: ExamModel; actions: ExamActions }>();
const connected = (event: Event) => (event.currentTarget as Node).isConnected;
</script>
<template>
  <button id="exam-start" type="button" class="header-action" :hidden="model.startHidden" :disabled="model.startDisabled" @click="connected($event) && actions.start()">开始考试</button>
  <span id="exam-status" class="exam-status" role="status" :hidden="model.statusHidden">{{ model.status }}</span>
  <button id="exam-submit" type="button" class="header-action" :hidden="model.submitHidden" :disabled="model.submitDisabled" @click="connected($event) && actions.submit()">{{ model.submitLabel }}</button>
  <button id="exam-return" type="button" class="header-action" :hidden="model.backHidden" :disabled="model.busy" @click="connected($event) && actions.back()">返回练习</button>
</template>
