<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { HistoryRoundSummary } from '../../../../shared/v2/api.js';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import { useWorkspaceNavigation } from '../router/injection';
import WorkspaceIcon from './WorkspaceIcon.vue';
import HistoryRoundItem from './HistoryRoundItem.vue';
import { useHistoryDeletion } from './history-deletion';
const practice = usePracticeStore();
const { overview, recovering } = storeToRefs(practice);
const { busy } = storeToRefs(useUiStore());
const navigation = useWorkspaceNavigation();
const root = ref<HTMLElement>(),
  trigger = ref<HTMLButtonElement>();
const open = ref(false),
  loading = ref(false),
  error = ref('');
const rounds = ref<HistoryRoundSummary[]>([]);
let generation = 0;
const { deleting, deleteError, remove } = useHistoryDeletion(practice, rounds, () => generation);
function close() {
  open.value = false;
  generation++;
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) {
    close();
  }
}
function escape(event: KeyboardEvent) {
  if (open.value && event.key === 'Escape') {
    close();
    trigger.value?.focus();
  }
}
async function toggle() {
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  loading.value = true;
  error.value = '';
  deleteError.value = '';
  const mine = ++generation;
  try {
    const value = await practice.historyList();
    if (mine === generation) {
      rounds.value = value;
    }
  } catch (failure) {
    if (mine === generation) {
      error.value = failure instanceof Error ? failure.message : '历史记录暂时无法读取。';
    }
  } finally {
    if (mine === generation) {
      loading.value = false;
    }
  }
}
function select(roundId: string) {
  close();
  void navigation.openHistory(roundId);
}
watch(() => overview.value?.bank.bankId, close);
onMounted(() => {
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  window.addEventListener('blur', close);
});
onBeforeUnmount(() => {
  close();
  document.removeEventListener('pointerdown', outside);
  document.removeEventListener('keydown', escape);
  window.removeEventListener('blur', close);
});
</script>
<template>
  <div
    ref="root"
    class="v2-history-menu"
  >
    <button
      ref="trigger"
      class="v2-history-trigger"
      :disabled="busy || recovering || (deleting && !open)"
      :aria-expanded="open"
      aria-controls="v2-history-popover"
      @click="toggle"
    >
      <WorkspaceIcon name="history" />历史记录
    </button>
    <section
      v-if="open"
      id="v2-history-popover"
      class="v2-history-popover"
      aria-label="历史记录"
    >
      <strong>历史记录</strong>
      <p
        v-if="deleteError"
        role="alert"
      >
        {{ deleteError }}
      </p>
      <p
        v-if="loading"
        role="status"
      >
        正在读取历史记录…
      </p>
      <p
        v-else-if="error"
        role="alert"
      >
        {{ error }}
      </p>
      <p v-else-if="rounds.length === 0">暂无历史记录</p>
      <ul v-else>
        <HistoryRoundItem
          v-for="round in rounds"
          :key="round.roundId"
          :round="round"
          :viewing="Boolean(overview?.readOnly && overview.roundId === round.roundId)"
          :deleting="deleting"
          @select="select"
          @remove="remove"
        />
      </ul>
    </section>
  </div>
</template>
<style scoped src="./HistoryMenu.css"></style>
