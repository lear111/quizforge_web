<script setup lang="ts">
defineProps<{ title: string; detail: string }>();
</script>
<template><span class="collection-loading-spinner" aria-hidden="true"></span><strong>加载中…</strong><span class="collection-loading-title">{{ title }}</span><small class="collection-loading-detail">{{ detail }}</small></template>
