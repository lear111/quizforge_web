<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useWorkspaceNavigation } from '../router/injection';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import PracticePage from './PracticePage.vue';
import FinalScore from '../components/FinalScore.vue';
import WorkspaceLibrary from '../components/WorkspaceLibrary.vue';
import WorkspaceOutline from '../components/WorkspaceOutline.vue';
import WorkspaceToolbar from '../components/WorkspaceToolbar.vue';
import WorkspaceMobile from '../components/WorkspaceMobile.vue';
import QuestionNavigation from '../components/QuestionNavigation.vue';
import { useLayoutStore } from '../stores/layout';
import '../styles/workspace.css';
defineProps<{ nonce: string }>();
const practice = usePracticeStore();
const { overview, outlineModel, recovering } = storeToRefs(practice);
const { busy, message, scoreView, drawer } = storeToRefs(useUiStore());
const navigation = useWorkspaceNavigation();
const layout = useLayoutStore();
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
    busy.value ||
    !confirm('完成练习后，答案将锁定，未作答题记 0 分。确定完成吗？')
  ) {
    return;
  }
  await practice.complete();
  await navigation.showCurrent();
}
onMounted(navigation.start);
async function resumeCompletion() {
  await practice.resumeCompletion();
  await navigation.showCurrent();
}
</script>
<template>
  <div
    class="v2-app"
    :style="layoutStyle"
    @keydown.esc="drawer = null"
  >
    <WorkspaceMobile />
    <button
      v-if="drawer"
      class="v2-scrim"
      aria-label="关闭侧栏"
      @click="drawer = null"
    ></button>
    <WorkspaceLibrary />
    <main class="v2-main">
      <WorkspaceToolbar />
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
          @view="navigation.showQuestion()"
          @grade="resumeCompletion"
          @complete="finishPractice"
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
