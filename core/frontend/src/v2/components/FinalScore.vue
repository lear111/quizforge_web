<script setup lang="ts">
import type { Completion } from '../types/practice-types';
defineProps<{ value: Completion; busy: boolean }>();
defineEmits<{ view: []; grade: [] }>();
</script>
<template>
  <section
    class="v2-final"
    aria-labelledby="v2-final-title"
  >
    <span
      class="v2-final-mark"
      aria-hidden="true"
      >✓</span
    >
    <h2 id="v2-final-title">本轮练习已完成</h2>
    <p class="v2-final-score">
      <strong>{{ value.total.score }}</strong><span>/ {{ value.total.maxScore }} 分</span>
    </p>
    <p>答案已锁定，仍可查看题目和写草稿笔记。</p>
    <p
      v-if="busy"
      role="status"
    >
      正在评分，总分将自动更新。
    </p>
    <div class="v2-final-actions">
      <button
        :disabled="busy"
        @click="$emit('view')"
      >
        查看题目</button
      ><button
        v-if="value.pendingGrading?.some((row) => row.question)"
        :disabled="busy"
        @click="$emit('grade')"
      >
        继续评分
      </button>
    </div>
  </section>
</template>
<style>
.v2-final {
  margin: 40px auto;
  padding: 36px 24px;
  max-width: 580px;
  width: calc(100% - 32px);
  border: 1px solid #e5def2;
  background: #fff;
  border-radius: 16px;
  text-align: center;
}
.v2-final-mark {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #eee8fc;
  color: #7358d5;
  font-size: 24px;
}
.v2-app .v2-final h2 {
  font-size: 20px;
  color: #343542;
  margin: 16px 0;
}
.v2-final p {
  color: #827b96;
}
.v2-final-score {
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: baseline;
}
.v2-final-score strong {
  font-size: 48px;
  color: #7358d5;
  font-weight: 600;
}
.v2-final-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}
.v2-final button {
  border: 1px solid #e5def6;
  background: white;
  color: #655389;
  border-radius: 8px;
  padding: 8px 16px;
  cursor: pointer;
}
</style>
