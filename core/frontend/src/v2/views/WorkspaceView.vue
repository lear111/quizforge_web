<script setup lang="ts">
import { onMounted } from 'vue';
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
import '../styles/workspace.css';
defineProps<{ nonce: string }>();
const practice = usePracticeStore();
const { overview } = storeToRefs(practice);
const { busy, message, scoreView } = storeToRefs(useUiStore());
const navigation = useWorkspaceNavigation();
onMounted(navigation.start);
async function resumeCompletion() {
  await practice.resumeCompletion();
  await navigation.showCurrent();
}
</script>
<template>
  <div class="v2-app">
    <WorkspaceMobile />
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
      <FinalScore
        v-if="overview && scoreView"
        :value="overview"
        :busy="busy"
        @view="navigation.showQuestion()"
        @grade="resumeCompletion"
      />
      <PracticePage
        :visible="!scoreView"
        :nonce="nonce"
      />
    </main>
    <WorkspaceOutline />
  </div>
</template>
<style scoped>
.v2-app {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr) 228px;
  min-height: 100dvh;
}
.v2-main {
  min-width: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100dvh;
}
.v2-error {
  margin: 16px 24px;
  padding: 12px;
  border: 1px solid #eac6c1;
  border-radius: 8px;
  color: #a13f31;
  background: #fff7f4;
}
@media (max-width: 800px) {
  .v2-app {
    display: block;
    padding-top: 56px;
  }
  .v2-main {
    height: calc(100dvh - 56px);
  }
}
.v2-app.v2-fullscreen {
  grid-template-columns: minmax(0, 1fr);
  padding-top: 0;
}
.v2-app.v2-fullscreen > .v2-library,
.v2-app.v2-fullscreen > .v2-outline,
.v2-app.v2-fullscreen > .v2-mobile,
.v2-fullscreen .v2-main > header {
  display: none;
}
.v2-fullscreen .v2-main {
  height: 100dvh;
}
</style>
