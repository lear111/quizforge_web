<script setup lang="ts">
defineProps<{ message: string; busy: boolean; run(command: 'retry' | 'load'): void }>();
const connected = (event: Event) => (event.currentTarget as Node).isConnected;
</script>
<template><span id="recovery-message">{{ message }}</span><div><button id="retry-save" :disabled="busy" @click="connected($event) && run('retry')">重试保存</button><button id="load-saved" :disabled="busy" @click="connected($event) && run('load')">读取已保存内容</button></div></template>
