<script setup lang="ts">
defineProps<{ expanded: boolean }>();
</script>
<template>
  <div
    class="library-group-transition"
    :class="{ expanded }"
    :inert="!expanded"
    :aria-hidden="!expanded"
  >
    <div class="library-group-clip"><slot /></div>
  </div>
</template>
<style scoped>
/* Opt-in only: V1 keeps its original div/hidden branch and DOM. */
.library-group-transition {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows 300ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.library-group-transition.expanded {
  grid-template-rows: 1fr;
  opacity: 1;
}
.library-group-clip {
  min-height: 0;
  overflow: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .library-group-transition {
    transition: none;
  }
}
</style>
