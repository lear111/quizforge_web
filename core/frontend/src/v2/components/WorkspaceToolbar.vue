<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import { useWorkspaceNavigation } from '../router/injection';
const practice = usePracticeStore();
const { overview, current, recovering, drafting } = storeToRefs(practice);
const { busy, loading, scoreView } = storeToRefs(useUiStore());
const navigation = useWorkspaceNavigation();
async function finishPractice() {
  if (
    !overview.value ||
    busy.value ||
    !confirm('完成练习后，答案将锁定，未作答题记 0 分。确定完成吗？')
  ) {
    return;
  }
  await practice.complete();
  await navigation.showCurrent();
}
async function refreshBank() {
  await practice.refreshBank();
  await navigation.showCurrent();
}
</script>
<template>
  <header class="v2-toolbar">
    <h1>{{ overview?.bank.title ?? '选择一本题库' }}</h1>
    <span
      v-if="loading"
      role="status"
      >{{ loading }}</span
    >
    <div class="v2-actions">
      <button
        v-if="current && !scoreView"
        :disabled="busy || recovering"
        @click="practice.toggleDraft()"
      >
        {{ drafting ? '返回作答' : '草稿' }}
      </button>
      <button
        v-if="overview && !overview.completedAt"
        :disabled="busy || recovering"
        @click="finishPractice"
      >
        完成练习
      </button>
      <button
        v-if="overview?.completedAt && !scoreView"
        :disabled="busy || recovering"
        @click="navigation.showSummary()"
      >
        最终得分
      </button>
      <button
        v-if="overview"
        :disabled="busy || recovering"
        @click="refreshBank"
      >
        刷新题库
      </button>
    </div>
  </header>
</template>
<style scoped>
.v2-toolbar {
  min-height: 64px;
  padding: 14px 24px;
  background: white;
  border-bottom: 1px solid #e6e3ee;
  display: flex;
  gap: 15px;
  align-items: center;
  justify-content: space-between;
}
h1 {
  font-size: 16px;
  margin: 0;
}
span {
  color: #756199;
}
.v2-actions {
  display: flex;
  gap: 8px;
}
.v2-actions button {
  white-space: nowrap;
}
@media (max-width: 800px) {
  .v2-toolbar {
    padding: 14px 16px;
    flex-wrap: wrap;
  }
}
</style>
