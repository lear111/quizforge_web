<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import { useWorkspaceNavigation } from '../router/injection';
import WorkspaceIcon from './WorkspaceIcon.vue';
const { overview, current, recovering } = storeToRefs(usePracticeStore());
const { busy, scoreView } = storeToRefs(useUiStore());
const navigation = useWorkspaceNavigation();
const ids = computed(
  () => overview.value?.outline.flatMap((group) => group.items.map((q) => q.id)) ?? [],
);
const index = computed(() => ids.value.indexOf(current.value?.questionId ?? ''));
const last = computed(() => index.value === ids.value.length - 1);
function previous() {
  if (index.value > 0) {
    void navigation.navigate(ids.value[index.value - 1]);
  }
}
function next() {
  if (last.value) {
    void navigation.showSummary();
  } else if (index.value >= 0) {
    void navigation.navigate(ids.value[index.value + 1]);
  }
}
</script>
<template>
  <template v-if="current && !scoreView">
    <button
      class="v2-side-nav previous"
      aria-label="上一题"
      title="上一题"
      :disabled="busy || recovering || index <= 0"
      @click="previous"
    >
      <WorkspaceIcon name="previous" />
    </button>
    <button
      class="v2-side-nav next"
      :aria-label="last ? '分数汇总' : '下一题'"
      :title="last ? '分数汇总' : '下一题'"
      :disabled="busy || recovering || index < 0"
      @click="next"
    >
      <WorkspaceIcon name="next" />
    </button>
  </template>
</template>
<style scoped>
.v2-side-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 4;
  width: 44px;
  height: 112px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid var(--qf-border-control);
  border-radius: 12px;
  color: var(--qf-text-secondary);
  background: var(--qf-surface);
}
.previous {
  left: 16px;
}
.next {
  right: 16px;
}
.v2-side-nav:hover:enabled {
  color: var(--qf-accent);
  border-color: var(--qf-accent);
}
@media (max-width: 900px) {
  .v2-side-nav {
    width: 32px;
    height: 72px;
  }
  .previous {
    left: 6px;
  }
  .next {
    right: 6px;
  }
}
</style>
