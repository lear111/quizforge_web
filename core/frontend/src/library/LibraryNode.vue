<script setup lang="ts">
import type { LibraryTree, LibraryActions, LibraryItem } from './types';
import { itemKind, errorMessage } from './types';
const props = defineProps<LibraryActions & { node: LibraryTree }>();
const name = (row: LibraryItem) => row.title || row.name;
const groupRow = (path: string, name: string) => ({ name, path, group: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' });
function open(row: LibraryItem) {
  if (row.error) props.onNotice(errorMessage(row) || '无法打开');
  else props.onOpen(itemKind(row, props.mode), row.id);
}
function metadata(row: LibraryItem) {
  if (row.kind === 'document') return `${row.format === 'pdf' ? 'PDF 文档' : 'Word 文档'} · ${(row.size || 0) < 1024 * 1024 ? Math.max(1, Math.round((row.size || 0) / 1024)) + ' KiB' : ((row.size || 0) / 1024 / 1024).toFixed(1) + ' MiB'}`;
  return errorMessage(row) || `${row.questionCount ?? 0} ${props.mode === 'bank' ? '道题目' : '道样例'}${row.version && !row.development ? ' · v' + row.version : ''}`;
}
</script>

<template>
  <section v-if="node.kind === 'group'" class="extension-group">
    <div class="library-group-header">
      <button type="button" class="extension-group-toggle" :data-extension-group="node.path"
        :aria-controls="`extension-group-${encodeURIComponent(node.path)}`" :aria-expanded="node.expanded"
        :aria-label="`${node.expanded ? '折叠' : '展开'} ${node.path}`" @click="onToggleGroup(node.path)">
        <span class="extension-group-arrow" aria-hidden="true">{{ node.expanded ? '▾' : '▸' }}</span><span class="extension-group-label">{{ node.name }}</span>
      </button>
      <span class="library-row-actions"><button v-if="canManage" type="button" class="library-manage-action" data-library-action="update"
        :title="`编辑分组 ${node.name}`" :aria-label="`编辑分组 ${node.name}`" @click="onManage('group', groupRow(node.path, node.name), 'update')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5-11 11H4v-5L15 4Zm-3 3 5 5" /></svg>
      </button></span>
    </div>
    <div :id="`extension-group-${encodeURIComponent(node.path)}`" class="extension-group-body" :hidden="!node.expanded">
      <LibraryNode v-for="child in node.children" :key="child.kind === 'group' ? `group:${child.path}` : `${itemKind(child.row, mode)}:${child.row.id}`"
        :node="child" :mode="mode" :active-key="activeKey" :can-manage="canManage" :on-toggle-group="onToggleGroup" :on-notice="onNotice" :on-open="onOpen" :on-manage="onManage" />
    </div>
  </section>
  <div v-else class="library-row">
    <button class="library-item" :class="{ active: `${itemKind(node.row, mode)}:${node.row.id}` === activeKey }" :data-item-id="node.row.id" :title="name(node.row)" @click="open(node.row)">
      <span class="item-icon" :class="node.row.kind === 'document' ? `document-file-icon ${node.row.format}` : ''" aria-hidden="true">{{ node.row.kind === 'document' ? (node.row.format === 'pdf' ? 'PDF' : 'WORD') : mode === 'bank' ? '▤' : node.row.development ? '⌘' : '◇' }}</span>
      <span class="item-body"><span class="item-title"><span class="item-name">{{ name(node.row) }}</span><span v-if="node.row.development" class="development-badge">开发版</span></span>
        <span class="item-meta" :class="{ 'item-error': node.row.error }">{{ metadata(node.row) }}</span></span>
    </button>
    <span class="library-row-actions"><button v-if="canManage" type="button" class="library-manage-action" data-library-action="update"
      :title="`编辑 ${name(node.row)}`" :aria-label="`编辑 ${name(node.row)}`" @click="onManage('item', node.row, 'update')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5-11 11H4v-5L15 4Zm-3 3 5 5" /></svg>
    </button></span>
  </div>
</template>
