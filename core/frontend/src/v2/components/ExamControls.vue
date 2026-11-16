<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import { useWorkspaceNavigation } from '../router/injection';
import { formatDuration } from './duration';

defineEmits<{ submit: [] }>();
const practice = usePracticeStore();
const { overview, examRemaining, recovering } = storeToRefs(practice);
const { busy } = storeToRefs(useUiStore());
const navigation = useWorkspaceNavigation();
const dialog = ref<HTMLDialogElement>();
const minutes = ref(60);
const seconds = computed(() => Math.ceil((examRemaining.value ?? 0) / 1000));

function configure() {
  minutes.value = 60;
  dialog.value?.showModal();
}

async function start() {
  if (!Number.isSafeInteger(minutes.value) || minutes.value <= 0) {
    return;
  }
  dialog.value?.close();
  await practice.startExam(minutes.value);
  await navigation.showCurrent();
}
</script>

<template>
  <template v-if="overview && !overview.readOnly">
    <template v-if="overview.exam && !overview.completedAt">
      <span
        class="v2-exam-clock"
        role="timer"
        aria-label="考试剩余时间"
      >
        考试中 <time>{{ formatDuration(seconds) }}</time>
      </span>
      <button
        class="v2-exam-button"
        :disabled="busy || recovering"
        @click="$emit('submit')"
      >
        {{ examRemaining === 0 ? '重试交卷' : '交卷' }}
      </button>
    </template>
    <button
      v-else-if="!overview.exam && overview.bank.features.exam !== false"
      class="v2-exam-button"
      :disabled="busy || recovering"
      @click="configure"
    >
      开始考试
    </button>
    <dialog
      ref="dialog"
      class="v2-exam-dialog"
      aria-labelledby="v2-exam-title"
    >
      <form @submit.prevent="start">
        <h2 id="v2-exam-title">开始考试</h2>
        <p>考试覆盖整本题库，关闭页面或程序不会暂停计时。</p>
        <label>
          考试时长（分钟）
          <input
            v-model.number="minutes"
            type="number"
            min="1"
            step="1"
            required
            autofocus
          />
        </label>
        <div class="v2-exam-dialog-actions">
          <button
            type="button"
            @click="dialog?.close()"
          >
            取消
          </button>
          <button
            type="submit"
            :disabled="busy"
          >
            开始
          </button>
        </div>
      </form>
    </dialog>
  </template>
</template>

<style scoped src="./ExamControls.css"></style>
