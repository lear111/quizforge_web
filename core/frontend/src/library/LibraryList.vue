<script setup lang="ts">
import LibraryNode from './LibraryNode.vue';
import type { LibraryTree, LibraryActions } from './types';
import { itemKind } from './types';
defineProps<LibraryActions & { groups: LibraryTree[]; emptyMessage: string }>();
</script>
<template>
  <LibraryNode v-for="node in groups" :key="node.kind === 'group' ? `group:${node.path}` : `${itemKind(node.row, mode)}:${node.row.id}`"
    :node="node" :mode="mode" :active-key="activeKey" :can-manage="canManage" :on-toggle-group="onToggleGroup" :on-notice="onNotice" :on-open="onOpen" :on-manage="onManage" />
  <p v-if="!groups.length" class="list-empty">{{ emptyMessage }}</p>
</template>
