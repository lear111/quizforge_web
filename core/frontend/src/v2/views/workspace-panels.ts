import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import { useLayoutStore } from '../stores/layout';
import { useUiStore } from '../stores/ui';

// Drawer focus and viewport changes affect presentation only, never navigation or saving.
export function useWorkspacePanels() {
  const layout = useLayoutStore();
  const ui = useUiStore();
  const media = window.matchMedia('(max-width: 900px)');
  let opener: HTMLElement | null = null;
  function resize() {
    layout.mobile = media.matches;
    ui.drawer = null;
  }
  onMounted(() => media.addEventListener('change', resize));
  onBeforeUnmount(() => media.removeEventListener('change', resize));
  watch(
    () => ui.drawer,
    async (drawer, previous) => {
      if (drawer && !previous) {
        opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      await nextTick();
      if (drawer !== ui.drawer) {
        return;
      }
      if (drawer) {
        document.querySelector<HTMLElement>(`#v2-${drawer} button`)?.focus();
      } else if (opener?.isConnected) {
        opener.focus();
        opener = null;
      }
    },
  );
}
