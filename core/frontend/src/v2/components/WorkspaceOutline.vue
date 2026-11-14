<script setup lang="ts">
import { storeToRefs } from 'pinia';
import OutlinePanel from '../../outline/OutlinePanel.vue';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import { useWorkspaceNavigation } from '../router/injection';
const { outlineModel } = storeToRefs(usePracticeStore());
const { drawer } = storeToRefs(useUiStore());
const navigation = useWorkspaceNavigation();
</script>
<template>
  <aside
    class="v2-outline v2-sidebar"
    :class="{ open: drawer === 'outline' }"
  >
    <h2>题目大纲</h2>
    <OutlinePanel
      :model="outlineModel"
      @navigate="navigation.navigate"
    />
  </aside>
</template>
<style scoped src="../styles/sidebar.css"></style>
<style scoped>
.v2-outline {
  border-left: 1px solid #e6e3ee;
}
:deep(.outline-group-title) {
  font-size: 13px;
  font-weight: 500;
  color: #827b96;
  margin: 16px 0;
}
:deep(.outline-matrix) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
:deep(.outline-item) {
  min-width: 40px;
  padding: 6px;
}
:deep(.outline-item.active) {
  box-shadow: 0 0 0 2px #b7a6e8;
}
:deep(.outline-item.correct) {
  background: #e5f5ec;
  color: #286b45;
}
:deep(.outline-item.wrong) {
  background: #fff0e5;
  color: #995b2f;
}
:deep(.outline-item.ungradable) {
  background: #ffedb7;
  color: #784500;
  border-color: #d89922;
}
:deep(.outline-item.answered) {
  background: #eee8fc;
  color: #655389;
}
@media (max-width: 800px) {
  .v2-outline {
    right: 0;
  }
}
</style>
