<script setup lang="ts">
import { ref } from 'vue';
import type { ExamModel, ExamActions } from './exam';
defineProps<{ model: ExamModel; actions: ExamActions }>();
const duration = ref('60'), unlimited = ref(false), durationInput = ref<HTMLInputElement>(), unlimitedInput = ref<HTMLInputElement>();
const connected = (event: Event) => (event.currentTarget as Node).isConnected;
defineExpose({ readFields: () => ({ duration: durationInput.value?.value || '', unlimited: !!unlimitedInput.value?.checked }) });
</script>
<template>
  <form @submit.prevent="connected($event) && actions.create()">
    <div class="exam-dialog-heading"><h2 id="exam-dialog-title">开始考试</h2><button type="button" class="exam-dialog-close" aria-label="关闭考试设置" :disabled="model.busy" @click="actions.close()">×</button></div>
    <p class="exam-intro">设置本次考试时长，或继续未完成的考试。</p>
    <section class="exam-settings">
      <label for="exam-duration" class="exam-duration-label">考试时长</label>
      <div class="exam-duration-control"><input id="exam-duration" ref="durationInput" v-model="duration" type="number" min="1" max="1440" required aria-label="考试时长（分钟）" :disabled="model.busy || unlimited"><span>分钟</span></div>
      <label class="exam-unlimited"><input ref="unlimitedInput" v-model="unlimited" type="checkbox" :disabled="model.busy">不限时</label>
      <p class="exam-hint">{{ unlimited ? '不限时考试持续计时，由你手动交卷。' : '到时自动交卷；交卷后锁定答案，统一评分。' }}</p>
    </section>
    <section class="exam-resume-section" :hidden="!model.rows.length">
      <h3>未完成考试</h3><div class="exam-records" :aria-busy="model.busy">
        <div v-for="row in model.rows" :key="row.id" class="exam-record-row">
          <button type="button" class="exam-record" :disabled="model.busy" @click="connected($event) && actions.resume(row.id)"><span class="exam-record-body"><span class="exam-record-title">{{ row.title }}</span><span class="exam-record-detail">{{ row.detail }}</span></span><span class="exam-record-status">{{ row.badge }}</span></button>
          <button type="button" class="exam-record-delete" title="删除考试" :aria-label="row.deleteLabel" :disabled="model.busy" @click="connected($event) && actions.remove(row.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg></button>
        </div>
      </div>
    </section>
    <p class="exam-error" role="alert" :hidden="!model.error">{{ model.error }}</p>
    <div class="dialog-actions"><button type="button" :disabled="model.busy" @click="actions.close()">取消</button><button type="submit" :disabled="model.busy">开始考试</button></div>
  </form>
</template>
