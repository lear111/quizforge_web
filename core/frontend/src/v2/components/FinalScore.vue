<script setup lang="ts">
import type { Completion } from '../types/practice-types';
defineProps<{ value: Completion; busy: boolean; unanswered: number }>();
defineEmits<{ view: []; grade: []; complete: [] }>();
</script>
<template>
  <div class="v2-summary-viewport">
    <section
      class="v2-final"
      aria-labelledby="v2-final-title"
    >
      <h2 id="v2-final-title">{{ value.completedAt ? '练习已完成' : '当前得分' }}</h2>
      <p class="v2-final-score">
        <strong>{{ value.total.score }}</strong><span>/ {{ value.total.maxScore }}</span>
      </p>
      <p>{{ value.completedAt ? '答案已锁定' : `还有 ${unanswered} 题未作答` }}</p>
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
          返回题目
        </button>
        <button
          v-if="!value.completedAt"
          class="primary"
          :disabled="busy"
          @click="$emit('complete')"
        >
          完成练习
        </button>
        <button
          v-if="value.completedAt && value.pendingGrading?.some((row) => row.question)"
          :disabled="busy"
          @click="$emit('grade')"
        >
          继续评分
        </button>
      </div>
    </section>
  </div>
</template>
<style scoped src="./FinalScore.css"></style>
