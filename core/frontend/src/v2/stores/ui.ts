import { ref } from 'vue';
import { defineStore } from 'pinia';

export const useUiStore = defineStore('v2-ui', () => {
  const busy = ref(false),
    message = ref(''),
    loading = ref('');
  const drawer = ref<'library' | 'outline' | null>(null);
  const token = ref(''),
    authRequired = ref(false),
    scoreView = ref(false);
  async function run(label: string, action: () => Promise<void>) {
    if (busy.value) {
      return;
    }
    busy.value = true;
    loading.value = label;
    message.value = '';
    try {
      await action();
    } catch (error) {
      message.value = error instanceof Error ? error.message : '操作未完成。';
    } finally {
      busy.value = false;
      loading.value = '';
    }
  }
  return { busy, message, loading, drawer, token, authRequired, scoreView, run };
});
