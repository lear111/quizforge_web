<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useWorkspaceNavigation } from '../router/injection';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import PracticePage from './PracticePage.vue';
import FinalScore from '../components/FinalScore.vue';
import HistoryBanner from '../components/HistoryBanner.vue';
import WorkspaceLibrary from '../components/WorkspaceLibrary.vue';
import WorkspaceOutline from '../components/WorkspaceOutline.vue';
import WorkspaceToolbar from '../components/WorkspaceToolbar.vue';
import { useExamSubmission } from './exam-submission';
import { useWorkspacePanels } from './workspace-panels';
import QuestionNavigation from '../components/QuestionNavigation.vue';
import { useLayoutStore } from '../stores/layout';
import '../styles/workspace.css';
defineProps<{ nonce: string }>();
const practice = usePracticeStore();
const { overview, outlineModel, recovering } = storeToRefs(practice);
const { busy, message, scoreView, drawer, loading } = storeToRefs(useUiStore());
const navigation = useWorkspaceNavigation();
const layout = useLayoutStore();
useWorkspacePanels();
const { submitExam } = useExamSubmission();
const layoutStyle = computed(() => ({
  '--v2-library-width': `${layout.widths.library}px`,
  '--v2-outline-width': `${layout.widths.outline}px`,
}));
const unanswered = computed(
  () =>
    outlineModel.value.groups
      .flatMap((g) => g.buttons)
      .filter((button) => button.status === 'unanswered').length,
);
async function finishPractice() {
  if (
    !overview.value ||
    overview.value.exam ||
    busy.value ||
    !confirm('完成练习后，答案将锁定，未作答题记 0 分。确定完成吗？')
  ) {
    return;
  }
  await practice.complete();
  await navigation.showSummary();
}
onMounted(navigation.start);
async function resumeCompletion() {
  await practice.resumeCompletion();
  await (overview.value?.completedAt ? navigation.showSummary() : navigation.showQuestion());
}
async function restartPractice() {
  const prompt = overview.value?.exam
    ? '本次考试将归档，尚未评分的题记 0 分，并返回原来的练习。确定归档吗？'
    : '上一轮练习将归档，尚未评分的题记 0 分。确定再练一次吗？';
  if (busy.value || !confirm(prompt)) {
    return;
  }
  await practice.restart();
  await navigation.showCurrent();
}
</script>
<template>
  <div
    class="v2-app"
    :style="layoutStyle"
    @keydown.esc="drawer = null"
  >
    <button
      class="v2-scrim"
      :class="{ open: drawer }"
      aria-label="关闭侧栏"
      :aria-hidden="!drawer"
      :inert="!drawer"
      tabindex="-1"
      @click="drawer = null"
    ></button>
    <WorkspaceLibrary />
    <main
      class="v2-main"
      :inert="layout.mobile && drawer !== null"
    >
      <WorkspaceToolbar @exam-submit="submitExam" />
      <HistoryBanner />
      <p
        v-if="message"
        class="v2-error"
        role="alert"
      >
        {{ message }}
      </p>
      <div class="v2-content">
        <FinalScore
          v-if="overview && scoreView"
          :value="overview"
          :busy="busy || recovering"
          :unanswered="unanswered"
          :activity="loading.startsWith('正在归档') ? loading : undefined"
          :exam="Boolean(overview.exam)"
          :read-only="overview.readOnly"
          @view="navigation.showQuestion()"
          @grade="resumeCompletion"
          @complete="finishPractice"
          @restart="restartPractice"
        />
        <PracticePage
          :visible="!scoreView"
          :nonce="nonce"
        />
        <QuestionNavigation />
      </div>
    </main>
    <WorkspaceOutline />
  </div>
</template>
<style scoped src="./WorkspaceView.css"></style>
