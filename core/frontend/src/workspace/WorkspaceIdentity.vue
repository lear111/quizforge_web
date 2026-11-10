<script setup lang="ts">
defineProps<{ title: string; group: string }>();
</script>
<template><span id="document-group" class="document-group" :hidden="!group">{{ group }}</span><h1 id="document-title">{{ title }}</h1></template>
