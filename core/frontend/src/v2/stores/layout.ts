import { reactive } from 'vue';
import { defineStore } from 'pinia';
import { readWidths, writeWidths, sidebarWidth, SIDEBARS } from '../services/sidebar-layout';
import type { Sidebar } from '../types/layout';

export const useLayoutStore = defineStore('v2-layout', () => {
  const widths = reactive(readWidths());
  const collapsed = reactive({ library: false, outline: false });
  function resize(side: Sidebar, width: number) {
    widths[side] = sidebarWidth(side, width);
  }
  function persist() {
    writeWidths(widths);
  }
  function reset(side: Sidebar) {
    widths[side] = SIDEBARS[side].initial;
    persist();
  }
  function toggle(side: Sidebar) {
    collapsed[side] = !collapsed[side];
  }
  return { widths, collapsed, bounds: SIDEBARS, resize, persist, reset, toggle };
});
