<script setup lang="ts">
import LibraryNode from './LibraryNode.vue';
import type { LibraryTree, LibraryProps, LibraryEvents } from './types';
import { itemKind } from './types';
defineProps<LibraryProps & { groups: LibraryTree[]; emptyMessage: string }>();
const emit = defineEmits<LibraryEvents>();
</script>
<template>
  <LibraryNode
    v-for="node in groups"
    :key="
      node.kind === 'group' ? `group:${node.path}` : `${itemKind(node.row, mode)}:${node.row.id}`
    "
    :node="node"
    :mode="mode"
    :active-key="activeKey"
    :can-manage="canManage"
    @toggle-group="emit('toggleGroup', $event)"
    @notice="emit('notice', $event)"
    @open="(kind, id) => emit('open', kind, id)"
    @manage="(target, row, action) => emit('manage', target, row, action)"
  />
  <p
    v-if="!groups.length"
    class="list-empty"
  >
    {{ emptyMessage }}
  </p>
</template>
