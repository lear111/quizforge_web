<script setup lang="ts">
import { computed } from 'vue';
import type { HistoryRoundSummary } from '../../../../shared/v2/api.js';
import { formatDuration } from './duration';
import WorkspaceIcon from './WorkspaceIcon.vue';

const props = defineProps<{ round: HistoryRoundSummary; viewing: boolean; deleting: boolean }>();
const emit = defineEmits<{ select: [id: string]; remove: [id: string] }>();
const date = computed(() => new Date(props.round.completedAt).toLocaleString());
const duration = computed(() => {
  const { startedAt, completedAt, kind } = props.round;
  return kind === 'exam' && startedAt
    ? formatDuration(
        Math.max(0, Math.floor((Date.parse(completedAt) - Date.parse(startedAt)) / 1000)),
      )
    : null;
});
const score = computed(() => `${props.round.score} / ${props.round.maxScore} 分`);

function confirmRemoval() {
  if (window.confirm(`删除 ${date.value} 的历史记录（${score.value}）？此操作无法撤销。`)) {
    emit('remove', props.round.roundId);
  }
}
</script>

<template>
  <li class="v2-history-row">
    <button
      class="v2-history-open"
      :disabled="deleting"
      @click="emit('select', round.roundId)"
    >
      <time :datetime="round.completedAt">{{ date }}</time>
      <span v-if="duration">考试 · 用时 {{ duration }}</span>
      <span>{{ score }}</span>
    </button>
    <button
      class="v2-history-delete"
      type="button"
      :aria-label="`删除 ${date} 的历史记录`"
      :title="viewing ? '请先退出该轮历史回看' : '删除历史记录'"
      :disabled="viewing || deleting"
      @click.stop="confirmRemoval"
    >
      <WorkspaceIcon name="trash" />
    </button>
  </li>
</template>
