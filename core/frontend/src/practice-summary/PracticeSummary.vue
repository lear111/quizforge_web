<script setup lang="ts">
import type { SummaryModel } from './summary';
const props = defineProps<{ model: SummaryModel; finish(): Promise<void> }>();
function finish(event: Event) { if ((event.currentTarget as Node).isConnected) void props.finish(); }
</script>
<template>
  <header class="practice-summary-header">
    <span class="practice-summary-badge">{{ model.badge }}</span>
    <h2 class="practice-summary-title">{{ model.title }}</h2>
    <p class="practice-summary-intro">{{ model.intro }}</p>
  </header>
  <div class="practice-summary-body">
    <div class="practice-summary-score-label">{{ model.scoreLabel }}</div>
    <div class="practice-summary-score">
      <strong class="practice-summary-earned">{{ model.earned }}</strong>
      <span class="practice-summary-separator">/</span>
      <span class="practice-summary-maximum">{{ model.maximum }}</span>
    </div>
    <div class="practice-summary-counts">
      <div class="practice-summary-count">{{ model.submitted }}</div>
      <div class="practice-summary-count">{{ model.pending }}</div>
      <div class="practice-summary-grading" :hidden="model.gradingHidden">{{ model.grading }}</div>
    </div>
  </div>
  <footer class="practice-summary-footer">
    <p class="practice-summary-note">{{ model.note }}</p>
    <p class="practice-summary-error" role="alert" :hidden="!model.error">{{ model.error }}</p>
    <button v-if="model.buttonVisible" type="button" class="practice-summary-finish" :class="{ 'is-busy': model.busy }"
      :disabled="model.buttonDisabled" :aria-busy="model.busy" @click="finish">{{ model.buttonLabel }}</button>
  </footer>
</template>
