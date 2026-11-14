<script setup lang="ts">
import { storeToRefs } from 'pinia';
import LibraryList from '../../library/LibraryList.vue';
import { useCatalogStore } from '../stores/catalog';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import { useWorkspaceNavigation } from '../router/injection';
const catalogStore = useCatalogStore();
const { groups } = storeToRefs(catalogStore);
const { overview } = storeToRefs(usePracticeStore());
const { drawer, token, authRequired, message } = storeToRefs(useUiStore());
const navigation = useWorkspaceNavigation();
function open(kind: string, bankId?: string) {
  void navigation.openBank(kind, bankId);
}
function notice(text: string) {
  message.value = text;
}
</script>
<template>
  <aside
    class="v2-library v2-sidebar"
    :class="{ open: drawer === 'library' }"
  >
    <div class="v2-brand">
      <span>Q</span>
      <div><strong>QuizForge</strong><small>你的练习空间 · V2</small></div>
    </div>
    <h2>我的题库</h2>
    <form
      v-if="authRequired"
      @submit.prevent="navigation.catalog()"
    >
      <label
        >连接令牌<input
          v-model="token"
          type="password"
          autocomplete="off"
      /></label>
      <button>连接</button>
    </form>
    <LibraryList
      :groups="groups"
      mode="bank"
      :active-key="overview ? `bank:${overview.bank.bankId}` : null"
      :can-manage="false"
      empty-message="暂无 V2 题库"
      @open="open"
      @toggle-group="catalogStore.toggleGroup"
      @notice="notice"
    />
  </aside>
</template>
<style scoped src="../styles/sidebar.css"></style>
<style scoped>
.v2-library {
  border-right: 1px solid #e6e3ee;
}
.v2-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
}
.v2-brand > span {
  background: var(--accent);
  color: white;
  border-radius: 10px;
  padding: 4px 12px;
  font-size: 22px;
}
.v2-brand strong {
  font-size: 17px;
}
.v2-brand small {
  display: block;
  color: #8b869a;
  font-size: 11px;
}
input {
  width: 100%;
}
:deep(.extension-group-toggle) {
  width: 100%;
  text-align: left;
  border: 0;
  background: none;
  display: flex;
  gap: 10px;
  padding: 10px 4px;
}
:deep(.library-row) {
  display: flex;
}
:deep(.library-item) {
  display: flex;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: 0;
  background: none;
  margin: 4px 0;
}
:deep(.library-item.active) {
  background: #eee8fc;
}
:deep(.item-body) {
  display: block;
}
:deep(.item-meta),
:deep(.library-row-actions) {
  display: none;
}
</style>
