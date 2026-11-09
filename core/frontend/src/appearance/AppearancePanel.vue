<script setup lang="ts">
import { ref } from 'vue';
import type { AppearanceState, AppearanceActions } from './settings';
const props = defineProps<{ state: AppearanceState; themes: readonly { id: string; label: string }[]; actions: AppearanceActions }>();
const file = ref<HTMLInputElement | null>(null), list = ref<HTMLElement | null>(null);
function move(event: KeyboardEvent) {
  const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
  if (!step) return;
  event.preventDefault();
  const index = props.themes.findIndex(item => item.id === props.state.value.theme);
  const next = props.themes[(index + step + props.themes.length) % props.themes.length];
  props.actions.select(next.id);
  list.value?.querySelector<HTMLButtonElement>(`[data-theme="${next.id}"]`)?.focus();
}
function choose() { props.actions.clearError(); file.value?.click(); }
function picked(event: Event) {
  const input = event.target as HTMLInputElement, picked = input.files?.[0];
  input.value = ''; void props.actions.choose(picked);
}
</script>

<template>
  <div id="appearance-themes" ref="list" class="appearance-themes" role="radiogroup" aria-label="主题" @keydown="move">
    <button v-for="theme in themes" :key="theme.id" type="button" class="appearance-theme" :data-theme="theme.id" role="radio" :aria-checked="state.value.theme === theme.id" :tabindex="state.value.theme === theme.id ? 0 : -1" @click="actions.select(theme.id)"><span class="appearance-swatch" :data-swatch="theme.id" aria-hidden="true"></span><span>{{ theme.label }}</span></button>
  </div>
  <div id="appearance-image" class="appearance-image" :hidden="!['image', 'coast'].includes(state.value.theme)">
    <div id="appearance-image-actions" class="appearance-image-actions" :hidden="state.value.theme !== 'image'"><button id="appearance-image-choose" type="button" :disabled="state.busy || !state.canChoose" @click="choose">{{ state.busy ? '正在处理图片…' : '选择图片' }}</button><button id="appearance-image-reset" type="button" :hidden="!state.value.custom" :disabled="state.busy" @click="actions.reset">恢复默认图片</button></div>
    <input id="appearance-image-file" ref="file" type="file" accept="image/*" hidden @change="picked">
    <label class="appearance-dim">遮罩<input id="appearance-dim" type="range" min="0" max="80" step="5" aria-label="背景遮罩强度" :value="state.value.dim" @input="actions.dim(Number(($event.target as HTMLInputElement).value))"><output id="appearance-dim-value" for="appearance-dim">{{ state.value.dim }}%</output></label>
    <small id="appearance-image-hint" class="network-settings-hint">{{ state.value.theme === 'coast' ? '内置青屿插画。遮罩越高，背景越柔和。' : '图片只保存在这台设备的浏览器中，不会上传。遮罩越高，文字越清楚。' }}</small>
  </div>
  <div id="appearance-panels" class="appearance-panels" :hidden="state.value.clear[state.value.theme] === undefined">
    <label class="appearance-dim">面板透明度<input id="appearance-clear" type="range" min="0" max="70" step="5" aria-label="题库列表、目录大纲和顶栏的透明度" :value="state.value.clear[state.value.theme]" @input="actions.clear(Number(($event.target as HTMLInputElement).value))"><output id="appearance-clear-value" for="appearance-clear">{{ state.value.clear[state.value.theme] === undefined ? '' : `${state.value.clear[state.value.theme]}%` }}</output></label>
    <small class="network-settings-hint">调节题库列表、目录大纲、顶栏和底栏透出背景的程度，每个主题分别记住。窄屏上弹出的侧栏保持不透明。</small>
  </div>
  <p class="network-settings-hint">外观只影响这台设备。主题改变侧栏、顶栏和题卡周围的底色；题卡由题型拓展绘制，草稿模式保持白板纸张，手机上的题目区域保持白底。</p>
  <p id="appearance-error" class="network-settings-error" role="alert" :hidden="!state.error">{{ state.error }}</p>
  <div class="dialog-actions"><button id="appearance-close" type="button" @click="actions.close">关闭</button></div>
</template>
