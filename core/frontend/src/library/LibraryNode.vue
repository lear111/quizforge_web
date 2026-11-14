<script setup lang="ts">
import LibraryItemView from './LibraryItem.vue';
import type { LibraryTree, LibraryProps, LibraryEvents } from './types';
import { itemKind } from './types';
defineProps<LibraryProps & { node: LibraryTree }>();
const emit = defineEmits<LibraryEvents>();
const groupRow = (path: string, name: string) => ({
  name,
  path,
  group: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
});
</script>

<template>
  <section
    v-if="node.kind === 'group'"
    class="extension-group"
  >
    <div class="library-group-header">
      <button
        type="button"
        class="extension-group-toggle"
        :data-extension-group="node.path"
        :aria-controls="`extension-group-${encodeURIComponent(node.path)}`"
        :aria-expanded="node.expanded"
        :aria-label="`${node.expanded ? '折叠' : '展开'} ${node.path}`"
        @click="emit('toggleGroup', node.path)"
      >
        <span
          class="extension-group-arrow"
          aria-hidden="true"
          >{{ node.expanded ? '▾' : '▸' }}</span><span class="extension-group-label">{{
          node.name
        }}</span>
      </button>
      <span class="library-row-actions"
        ><button
          v-if="canManage"
          type="button"
          class="library-manage-action"
          data-library-action="update"
          :title="`编辑分组 ${node.name}`"
          :aria-label="`编辑分组 ${node.name}`"
          @click="emit('manage', 'group', groupRow(node.path, node.name), 'update')"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="m15 4 5 5-11 11H4v-5L15 4Zm-3 3 5 5" />
          </svg></button
      ></span>
    </div>
    <div
      :id="`extension-group-${encodeURIComponent(node.path)}`"
      class="extension-group-body"
      :hidden="!node.expanded"
    >
      <LibraryNode
        v-for="child in node.children"
        :key="
          child.kind === 'group'
            ? `group:${child.path}`
            : `${itemKind(child.row, mode)}:${child.row.id}`
        "
        :node="child"
        :mode="mode"
        :active-key="activeKey"
        :can-manage="canManage"
        @toggle-group="emit('toggleGroup', $event)"
        @notice="emit('notice', $event)"
        @open="(kind, id) => emit('open', kind, id)"
        @manage="(target, row, action) => emit('manage', target, row, action)"
      />
    </div>
  </section>
  <LibraryItemView
    v-else
    :row="node.row"
    :mode="mode"
    :active-key="activeKey"
    :can-manage="canManage"
    @notice="emit('notice', $event)"
    @open="(kind, id) => emit('open', kind, id)"
    @manage="(target, row, action) => emit('manage', target, row, action)"
  />
</template>
