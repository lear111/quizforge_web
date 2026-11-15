<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import OutlinePanel from '../../outline/OutlinePanel.vue';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import { useLayoutStore } from '../stores/layout';
import { useWorkspaceNavigation } from '../router/injection';
import SidebarResize from './SidebarResize.vue';
import WorkspaceIcon from './WorkspaceIcon.vue';
const { outlineModel, overview, recovering } = storeToRefs(usePracticeStore());
const { drawer, scoreView, busy } = storeToRefs(useUiStore());
const layout = useLayoutStore();
const navigation = useWorkspaceNavigation();
const buttons = computed(() => outlineModel.value.groups.flatMap((group) => group.buttons));
const answered = computed(
  () => buttons.value.filter((button) => button.status !== 'unanswered').length,
);
const legend = [
  ['answered', '已作答'],
  ['correct', '正确'],
  ['wrong', '错误'],
];
</script>
<template>
  <aside
    id="v2-outline"
    class="v2-outline v2-sidebar"
    :class="{ open: drawer === 'outline', closed: layout.collapsed.outline }"
    aria-label="题目大纲"
  >
    <SidebarResize side="outline" />
    <header class="v2-sidebar-heading">
      <strong>题目大纲</strong>
      <span class="v2-progress">{{ answered }} / {{ buttons.length }}</span>
    </header>
    <div class="v2-outline-content">
      <OutlinePanel
        :model="outlineModel"
        @navigate="navigation.navigate"
      />
      <button
        v-if="overview"
        class="v2-summary-entry"
        :class="{ active: scoreView }"
        :aria-current="scoreView ? 'page' : undefined"
        :disabled="busy || recovering"
        @click="navigation.showSummary()"
      >
        <WorkspaceIcon name="summary" />分数汇总
      </button>
    </div>
    <footer class="v2-legend">
      <span
        v-for="[status, label] in legend"
        :key="status"
      >
        <i
          :class="status"
          aria-hidden="true"
        ></i
        >{{ label }}</span
      >
    </footer>
  </aside>
</template>
<style scoped src="../styles/sidebar.css"></style>
<style scoped src="./WorkspaceOutline.css"></style>
