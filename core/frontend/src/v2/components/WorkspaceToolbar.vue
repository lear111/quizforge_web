<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import { useCatalogStore } from '../stores/catalog';
import { useLayoutStore } from '../stores/layout';
import { useWorkspaceNavigation } from '../router/injection';
import WorkspaceIcon from './WorkspaceIcon.vue';
const practice = usePracticeStore();
const { overview, current, recovering, drafting } = storeToRefs(practice);
const { busy, loading, scoreView } = storeToRefs(useUiStore());
const catalog = useCatalogStore();
const layout = useLayoutStore();
const navigation = useWorkspaceNavigation();
const groupName = computed(() => {
  const group = catalog.groups.find(
    (g) =>
      g.kind === 'group' &&
      g.children.some(
        (child) => child.kind === 'extension' && child.row.id === overview.value?.bank.bankId,
      ),
  );
  return group?.kind === 'group' ? group.name : '';
});
async function refreshBank() {
  await practice.refreshBank();
  await navigation.showCurrent();
}
</script>
<template>
  <header
    class="v2-toolbar"
    :class="{ empty: !overview }"
  >
    <button
      class="v2-icon-button desktop"
      aria-label="收起或展开题库栏"
      :aria-expanded="!layout.collapsed.library"
      aria-controls="v2-library"
      @click="layout.toggle('library')"
    >
      <WorkspaceIcon name="library" />
    </button>
    <div class="v2-bank-heading">
      <span>{{ groupName }}</span>
      <h1>{{ overview?.bank.title ?? '选择一本题库' }}</h1>
    </div>
    <span
      v-if="loading"
      class="v2-loading"
      role="status"
      >{{ loading }}</span
    >
    <div class="v2-actions">
      <button
        v-if="current && !scoreView"
        class="v2-draft-button"
        :class="{ active: drafting }"
        :disabled="busy || recovering"
        @click="practice.toggleDraft()"
      >
        <WorkspaceIcon name="draft" />{{ drafting ? '返回作答' : '草稿' }}
      </button>
      <button
        v-if="overview"
        class="v2-icon-button"
        aria-label="刷新题库"
        title="刷新题库"
        :disabled="busy || recovering"
        @click="refreshBank"
      >
        <WorkspaceIcon name="refresh" />
      </button>
    </div>
    <button
      class="v2-icon-button desktop"
      aria-label="收起或展开大纲栏"
      :aria-expanded="!layout.collapsed.outline"
      aria-controls="v2-outline"
      @click="layout.toggle('outline')"
    >
      <WorkspaceIcon name="outline" />
    </button>
  </header>
</template>
<style scoped src="./WorkspaceToolbar.css"></style>
