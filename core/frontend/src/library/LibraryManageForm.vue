<script setup lang="ts">
import { ref } from 'vue';
import type { LibraryManagement, ManagementState } from './management';
defineProps<{ state: ManagementState; actions: LibraryManagement }>();
const name = ref<HTMLInputElement | null>(null), group = ref<HTMLSelectElement | null>(null), cancel = ref<HTMLButtonElement | null>(null);
const draft = () => ({ name: name.value?.value || '', group: group.value?.value || '' });
defineExpose({ focus(target: 'name' | 'cancel') { (target === 'name' ? name.value : cancel.value)?.focus(); } });
</script>

<template>
  <form id="library-manage-form" :aria-busy="state.busy" @submit.prevent="actions.submit(draft())">
    <div class="dialog-heading">
      <h2 id="library-manage-title">{{ state.title }}</h2><button id="library-manage-close" class="icon-button" type="button" aria-label="关闭目录编辑" :disabled="state.busy" @click="actions.close">×</button>
    </div>
    <p id="library-manage-hint" class="library-manage-hint">{{ state.hint }}</p>
    <div id="library-manage-fields" :hidden="state.removing || state.readOnly">
      <label>名称<input id="library-manage-name" ref="name" :value="state.name" maxlength="300" autocomplete="off" :disabled="state.busy" @input="actions.edit(draft())"></label>
      <label :hidden="!state.groupVisible">所属分组<select id="library-manage-group" ref="group" :value="state.group" :disabled="state.busy" @change="actions.edit(draft())">
        <option value="">未分组（根目录）</option><option v-for="path in state.groups" :key="path" :value="path">{{ path }}</option>
      </select></label>
    </div>
    <p id="library-manage-status" class="library-manage-hint" role="status" :hidden="!state.status">{{ state.status }}</p>
    <p id="library-manage-error" class="library-manage-error" role="alert" :hidden="!state.error">{{ state.error }}</p>
    <div class="library-manage-footer">
      <div id="library-manage-more" class="library-manage-more" :hidden="!state.moreVisible">
        <button id="library-manage-export" type="button" :hidden="!state.exportVisible" :disabled="state.busy" @click="actions.exportSaved(draft())">{{ state.exportLabel }}</button>
        <button id="library-manage-delete" type="button" :disabled="state.busy" @click="actions.remove(draft())">删除</button>
      </div>
      <div class="dialog-actions">
        <button id="library-manage-cancel" ref="cancel" type="button" :hidden="state.creatingGroup" :disabled="state.busy" @click="actions.cancel">{{ state.readOnly ? '关闭' : '取消' }}</button>
        <button id="library-manage-confirm" type="submit" :hidden="state.readOnly" :class="{ 'danger-button': state.removing }" :disabled="state.busy">{{ state.removing ? '移入回收目录' : '保存' }}</button>
      </div>
    </div>
  </form>
</template>
