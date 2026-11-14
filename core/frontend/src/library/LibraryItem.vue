<script setup lang="ts">
import { computed } from 'vue';
import type { LibraryItem, LibraryProps, LibraryEvents } from './types';
import { itemKind, errorMessage } from './types';
const props = defineProps<LibraryProps & { row: LibraryItem }>();
const emit = defineEmits<LibraryEvents>();
const title = computed(() => props.row.title || props.row.name);
const metadata = computed(() => {
  const row = props.row;
  if (row.kind === 'document') {
    const size = row.size || 0;
    const sizeText =
      size < 1024 * 1024
        ? Math.max(1, Math.round(size / 1024)) + ' KiB'
        : (size / 1024 / 1024).toFixed(1) + ' MiB';
    return `${row.format === 'pdf' ? 'PDF 文档' : 'Word 文档'} · ${sizeText}`;
  }
  return (
    errorMessage(row) ||
    `${row.questionCount ?? 0} ${props.mode === 'bank' ? '道题目' : '道样例'}${row.version && !row.development ? ' · v' + row.version : ''}`
  );
});
const icon = computed(() => {
  if (props.row.kind === 'document') {
    return props.row.format === 'pdf' ? 'PDF' : 'WORD';
  }
  if (props.mode === 'bank') {
    return '▤';
  }
  return props.row.development ? '⌘' : '◇';
});
function open(row: LibraryItem) {
  if (row.error) {
    emit('notice', errorMessage(row) || '无法打开');
  } else {
    emit('open', itemKind(row, props.mode), row.id);
  }
}
</script>
<template>
  <div class="library-row">
    <button
      class="library-item"
      :class="{ active: `${itemKind(row, mode)}:${row.id}` === activeKey }"
      :data-item-id="row.id"
      :title="title"
      @click="open(row)"
    >
      <span
        class="item-icon"
        :class="row.kind === 'document' ? `document-file-icon ${row.format}` : ''"
        aria-hidden="true"
        >{{ icon }}</span
      >
      <span class="item-body"
        ><span class="item-title"
          ><span class="item-name">{{ title }}</span
          ><span
            v-if="row.development"
            class="development-badge"
            >开发版</span
          ></span
        >
        <span
          class="item-meta"
          :class="{ 'item-error': row.error }"
          >{{ metadata }}</span
        ></span
      >
    </button>
    <span class="library-row-actions"
      ><button
        v-if="canManage"
        type="button"
        class="library-manage-action"
        data-library-action="update"
        :title="`编辑 ${title}`"
        :aria-label="`编辑 ${title}`"
        @click="emit('manage', 'item', row, 'update')"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="m15 4 5 5-11 11H4v-5L15 4Zm-3 3 5 5" />
        </svg></button
    ></span>
  </div>
</template>
