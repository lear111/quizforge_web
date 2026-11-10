<script setup lang="ts">
defineProps<{ detail: string; decide(accepted: boolean): void }>();
</script>
<template>
  <h2 id="exam-delete-title">删除这次考试？</h2>
  <p class="exam-delete-detail">{{ detail }}</p>
  <p>删除后无法继续这次考试，已保存的答案和草稿将不再显示。普通练习和其他历史记录会保留。</p>
  <div class="dialog-actions"><button type="button" autofocus @click="decide(false)">取消</button><button type="button" class="danger-button" @click="decide(true)">删除考试</button></div>
</template>
