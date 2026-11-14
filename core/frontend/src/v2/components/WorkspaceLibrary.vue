<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import LibraryList from '../../library/LibraryList.vue';
import SidebarResize from './SidebarResize.vue';
import WorkspaceIcon from './WorkspaceIcon.vue';
import { useLayoutStore } from '../stores/layout';
import { useCatalogStore } from '../stores/catalog';
import { usePracticeStore } from '../stores/practice';
import { useUiStore } from '../stores/ui';
import { useWorkspaceNavigation } from '../router/injection';
const catalogStore = useCatalogStore();
const layout = useLayoutStore();
const { groups } = storeToRefs(catalogStore);
const { overview } = storeToRefs(usePracticeStore());
const { drawer, token, authRequired, message } = storeToRefs(useUiStore());
const navigation = useWorkspaceNavigation();
// Catalog has no count field; only the opened bank has a verified question count.
const listGroups = computed(() =>
  groups.value.map((group) =>
    group.kind !== 'group'
      ? group
      : {
          ...group,
          children: group.children.map((child) =>
            child.kind !== 'extension'
              ? child
              : {
                  ...child,
                  row: {
                    ...child.row,
                    questionCount:
                      overview.value && child.row.id === overview.value.bank.bankId
                        ? overview.value.outline.reduce(
                            (count, section) => count + section.items.length,
                            0,
                          )
                        : undefined,
                  },
                },
          ),
        },
  ),
);
function open(kind: string, bankId?: string) {
  void navigation.openBank(kind, bankId);
}
function notice(text: string) {
  message.value = text;
}
</script>
<template>
  <aside
    id="v2-library"
    aria-label="题库"
    class="v2-library v2-sidebar"
    :class="{ open: drawer === 'library', closed: layout.collapsed.library }"
  >
    <SidebarResize side="library" />
    <div class="v2-brand v2-sidebar-heading">
      <span><WorkspaceIcon name="brand" /></span>
      <div><strong>QuizForge</strong><small>你的练习空间</small></div>
    </div>
    <div class="v2-library-heading">
      <h2>我的题库</h2>
      <button
        class="v2-icon-button"
        aria-label="刷新题库列表"
        title="刷新题库列表"
        @click="navigation.catalog()"
      >
        <WorkspaceIcon name="refresh" />
      </button>
    </div>
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
    <nav
      class="v2-library-tree"
      aria-label="题库列表"
    >
      <LibraryList
        :groups="listGroups"
        mode="bank"
        :active-key="overview ? `bank:${overview.bank.bankId}` : null"
        :can-manage="false"
        empty-message="暂无 V2 题库"
        @open="open"
        @toggle-group="catalogStore.toggleGroup"
        @notice="notice"
      />
    </nav>
  </aside>
</template>
<style scoped src="../styles/sidebar.css"></style>
<style scoped src="./WorkspaceLibrary.css"></style>
