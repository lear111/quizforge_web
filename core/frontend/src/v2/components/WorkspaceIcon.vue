<script setup lang="ts">
defineProps<{ name: keyof typeof paths }>();
const paths = {
  brand: 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM8 11l2 2 4-4m2.5 7.5L20 20',
  library: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm4 0v16',
  outline: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm10 0v16',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  draft: 'M4 20l4-1L19 8l-3-3L5 16ZM14 6l3 3',
  summary: 'M4 20V10m6 10V4m6 16v-7m6 7H2',
  previous: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
};
</script>
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name]" />
  </svg>
</template>
<style scoped>
svg {
  width: 18px;
  height: 18px;
  flex: none;
}
</style>
