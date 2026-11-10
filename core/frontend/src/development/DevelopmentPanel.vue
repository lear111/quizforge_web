<script setup lang="ts">
import { computed } from 'vue';
import type { DevelopmentActions, DevelopmentState } from './settings';
const props = defineProps<{ state: DevelopmentState; actions: DevelopmentActions }>();
const unavailable = computed(() => props.state.busy || !props.state.settings || props.state.settings.canManage === false);
function change(event: Event) {
  const input = event.target as HTMLInputElement;
  if (unavailable.value) { input.checked = props.state.checked; return; }
  void props.actions.save(input.checked);
}
</script>
<template>
  <div style="display:contents">
    <label class="network-settings-switch"><span>显示拓展管理<small
          id="development-settings-hint">仅控制拓展管理入口显示，不影响题库使用</small></span><input id="development-settings-enabled"
        type="checkbox" role="switch" aria-label="显示拓展管理" aria-describedby="development-settings-hint"
        :checked="state.checked" :disabled="unavailable" @change="change"></label>
    <p id="development-settings-status" role="status" :hidden="!state.status">{{ state.status }}</p>
    <p id="development-settings-error" role="alert" :hidden="!state.error">{{ state.error }}</p>
    <div class="dialog-actions"><button id="development-settings-close" type="button" @click="actions.close">关闭</button></div>
  </div>
</template>
