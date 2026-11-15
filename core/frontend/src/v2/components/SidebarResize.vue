<script setup lang="ts">
import { ref } from 'vue';
import { useLayoutStore } from '../stores/layout';
import type { Sidebar } from '../types/layout';
const props = defineProps<{ side: Sidebar }>();
const layout = useLayoutStore();
const drag = ref<{ id: number; x: number; width: number } | null>(null);
function start(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary) {
    return;
  }
  drag.value = { id: event.pointerId, x: event.clientX, width: layout.widths[props.side] };
  const handle = event.currentTarget as HTMLElement;
  handle.focus();
  handle.setPointerCapture(event.pointerId);
}
function move(event: PointerEvent) {
  if (!drag.value || drag.value.id !== event.pointerId) {
    return;
  }
  const direction = props.side === 'library' ? 1 : -1;
  layout.resize(props.side, drag.value.width + (event.clientX - drag.value.x) * direction);
}
function end() {
  if (!drag.value) {
    return;
  }
  drag.value = null;
  layout.persist();
}
function key(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    return;
  }
  event.preventDefault();
  const direction = (event.key === 'ArrowRight' ? 1 : -1) * (props.side === 'library' ? 1 : -1);
  layout.resize(props.side, layout.widths[props.side] + direction * 16);
  layout.persist();
}
</script>
<template>
  <div
    class="v2-resize"
    :class="[side, { dragging: drag }]"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="`调整${side === 'library' ? '题库' : '大纲'}栏宽度`"
    :aria-valuenow="layout.widths[side]"
    :aria-valuemin="layout.bounds[side].min"
    :aria-valuemax="layout.bounds[side].max"
    @pointerdown.prevent="start"
    @pointermove="move"
    @pointerup="end"
    @pointercancel="end"
    @lostpointercapture="end"
    @dblclick="layout.reset(side)"
    @keydown="key"
  ></div>
</template>
<style scoped>
.v2-resize {
  position: absolute;
  inset: 0 -4px 0 auto;
  width: 8px;
  z-index: 5;
  cursor: col-resize;
  touch-action: none;
  outline: none;
}
.v2-resize.outline {
  left: -4px;
  right: auto;
}
.v2-resize::after {
  content: '';
  position: absolute;
  inset: 0 3px;
  width: 2px;
  background: transparent;
}
.v2-resize:hover::after,
.v2-resize:focus-visible::after,
.v2-resize.dragging::after {
  background: var(--qf-accent);
}
@media (max-width: 900px) {
  .v2-resize {
    display: none;
  }
}
</style>
