<script setup lang="ts">
import type { PracticeWorkspace } from './practice-types';
import { usePracticePage } from './use-practice-page';

const props = defineProps<{ nonce: string; requestPrefix: (bankId: string) => string; workspace: PracticeWorkspace; busy: boolean; visible: boolean }>();
const page = usePracticePage(props.workspace, bankId => props.requestPrefix(bankId), props.nonce);
const { current, container, typeName, saveStatus, recovering, viewport, stage, world, continueGrading, retrySave } = page;
const { drafting, flush, show, clearQuestion, resetSources, scopeSources, recoverPending, toggleDraft, pageFaulted, complete, resumeCompletion } = page;
defineExpose({ current, recovering, drafting, flush, show, clearQuestion, resetSources, scopeSources, recoverPending, toggleDraft, pageFaulted, complete, resumeCompletion });
</script>
<template>
  <div v-if="!current && visible" class="v2-empty">从一道题开始<p>选择左侧题库，开始练习。</p></div>
  <div v-show="current && visible" ref="viewport" class="v2-viewport" :inert="busy || recovering"><div ref="stage" class="v2-stage"><div ref="world" class="v2-world">
  <section v-show="current" class="v2-card" :aria-busy="busy || recovering"><div class="v2-question-heading"><span>{{ typeName }}</span><span>{{ current?.state.maxScore }} 分</span></div><div ref="container" class="v2-question-frame" :inert="busy || recovering"></div>
    <div class="v2-answer-footer"><span v-if="saveStatus" class="v2-save-status" role="status">{{ saveStatus }}</span><button v-if="saveStatus === '保存失败'" :disabled="busy" @click="retrySave">重试保存</button>
      <button v-if="current && current.submissionId !== null && current.result === null && !busy" @click="continueGrading">继续评分</button>
    </div>
  </section>
  </div></div></div>
</template>
