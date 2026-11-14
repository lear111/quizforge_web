<script setup lang="ts">
import { RouterView } from 'vue-router';
defineProps<{ nonce: string }>();
</script>
<template>
  <RouterView v-slot="{ Component }">
    <component
      :is="Component"
      :nonce="nonce"
    />
  </RouterView>
</template>
