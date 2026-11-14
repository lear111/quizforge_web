import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { PracticeApi } from '../api';
import type { LibraryTree } from '../../library/types';

export const useCatalogStore = defineStore('v2-catalog', () => {
  const groups = ref<LibraryTree[]>([]);
  async function read(api: PracticeApi) {
    const value = await api.catalog.get();
    groups.value = value.groups.map((group) => ({
      kind: 'group',
      path: group.id,
      name: group.name,
      expanded: false,
      children: group.items.map((row) => ({
        kind: 'extension',
        row: { id: row.bankId, title: row.title, kind: 'bank', error: row.error ?? undefined },
      })),
    }));
  }
  function toggleGroup(id: string) {
    const group = groups.value.find((group) => group.kind === 'group' && group.path === id);
    if (group?.kind === 'group') {
      group.expanded = !group.expanded;
    }
  }
  return { groups, read, toggleGroup };
});
