<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import { useWorkspaceNavigation } from '../router/injection';
const { overview, current } = storeToRefs(usePracticeStore());
const { busy } = storeToRefs(useUiStore());
const navigation = useWorkspaceNavigation();
</script>
<template>
  <section
    v-if="overview?.readOnly"
    class="v2-history-banner"
    aria-label="历史回看"
  >
    <div>
      <strong>历史回看</strong
      ><span :title="overview.roundId"
        >轮次 {{ overview.roundId?.slice(0, 8) }} ·
        {{ new Date(overview.completedAt!).toLocaleString() }}</span
      ><span>当时得分：{{ overview.total.score }} / {{ overview.total.maxScore }} 分</span
      ><span v-if="!current && overview.lastQuestionId"
        >本题：{{ overview.states.find((s) => s.questionId === overview?.lastQuestionId)?.score }} /
        {{ overview.states.find((s) => s.questionId === overview?.lastQuestionId)?.maxScore }}
        分</span
      >
    </div>
    <button
      :disabled="busy"
      @click="navigation.returnToPractice()"
    >
      返回当前练习
    </button>
  </section>
</template>
<style scoped>
.v2-history-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  border-bottom: 1px solid #dfd6ee;
  background: #f5f1fc;
  color: #443263;
}
.v2-history-banner div {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 5px 14px;
  min-width: 0;
}
.v2-history-banner span {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.v2-history-banner button {
  flex: none;
}
@media (max-width: 600px) {
  .v2-history-banner {
    align-items: flex-start;
    padding: 9px 12px;
  }
  .v2-history-banner div {
    flex-direction: column;
  }
}
</style>
