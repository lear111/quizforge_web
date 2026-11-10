<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
const props = defineProps<{ url: string; copy(value: string): Promise<unknown> }>();
const label = ref('复制'); let disposed = false, revision = 0, timer: ReturnType<typeof setTimeout> | undefined;
async function copy() {
  const current = ++revision; clearTimeout(timer);
  try { await props.copy(props.url); if (disposed || current !== revision) return; label.value = '已复制'; }
  catch { if (disposed || current !== revision) return; label.value = '复制失败'; }
  timer = setTimeout(() => { label.value = '复制'; }, 1500);
}
onBeforeUnmount(() => { disposed = true; ++revision; clearTimeout(timer); });
</script>
<template><div class="network-connection-url"><code>{{ url }}</code><button type="button" class="network-connection-copy" :aria-label="`复制 ${url}`" @click="copy">{{ label }}</button></div></template>
