<script setup lang="ts">
import type { OutlineModel, OutlineButton } from './model';
const props = defineProps<{ model: OutlineModel; onNavigate(questionId: string, itemId: string | null): unknown; onSummary(): unknown }>();
function navigate(button: OutlineButton, event: Event) {
  if ((event.currentTarget as Node).isConnected) props.onNavigate(button.questionId, button.itemId);
}
function summary(event: Event) {
  if ((event.currentTarget as Node).isConnected && props.model.summaryAvailable) props.onSummary();
}
</script>
<template>
  <section v-for="group in model.groups" :key="group.key" class="outline-group">
    <h2 class="outline-group-title">{{ group.name }}</h2>
    <div class="outline-matrix">
      <button v-for="button in group.buttons" :key="button.key" type="button"
        class="outline-item" :class="[button.status, { 'outline-child': button.itemId !== null, active: button.active }]"
        :data-question-id="button.questionId" :data-outline-item-id="button.itemId"
        :title="button.title" :aria-label="button.ariaLabel" :aria-current="button.active ? 'true' : 'false'"
        @click="navigate(button, $event)">{{ button.label }}</button>
    </div>
  </section>
  <button v-if="model.summaryAvailable" type="button" class="outline-score-summary" :class="{ active: model.summaryShown }" @click="summary">分值汇总</button>
</template>
