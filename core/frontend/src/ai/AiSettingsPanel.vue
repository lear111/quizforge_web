<script setup lang="ts">
import { computed, ref } from 'vue';
import { quota, reportMeta, type AiActions, type AiFields, type AiState } from './settings';
const props = defineProps<{ state: AiState; actions: AiActions }>();
const root = ref<HTMLElement | null>(null), keyInput = ref<HTMLInputElement | null>(null);
const unavailable = computed(() => props.state.busy || !props.state.settings || props.state.settings.canManage === false);
const filled = computed(() => !!(props.state.fields.baseUrl.trim() && props.state.fields.model.trim()));
const points = computed(() => quota(props.state));
const keyHint = computed(() => props.state.settings?.canManage === false ? 'API Key 由主机保存，仅主机可修改。' : props.state.settings?.apiKeyConfigured ? 'API Key 已保存并隐藏。可直接删除或输入新值，保存后生效。' : '本地模型可以不填 API Key。');
const labels: Record<string, string> = { passed: '通过', failed: '未通过', unknown: '无法判断', skipped: '未测试' };
function readFields(): AiFields {
  const get = (id: string) => root.value!.querySelector<HTMLInputElement>(`#ai-settings-${id}`)!;
  return { enabled: get('enabled').checked, autoGrade: get('autoGrade').checked, useOfficial: get('useOfficial').checked, useCustom: get('useCustom').checked, baseUrl: get('baseUrl').value, model: get('model').value };
}
defineExpose({ readFields, readKey: () => keyInput.value?.value || '', writeKey(key: string) { if (keyInput.value) keyInput.value.value = key; } });
</script>
<template>
  <div ref="root" class="ai-settings-form">
        <p id="ai-settings-status" role="status">{{ state.status }}</p>
        <label class="network-settings-switch"><span>开启 AI 评分<small>打开后选择评分来源；关闭时仍可人工评分</small></span><input
            id="ai-settings-enabled" :checked="state.fields.enabled" :disabled="unavailable" @change="actions.toggle('enabled')" type="checkbox" role="switch" aria-label="开启 AI 评分"></label>
        <div id="ai-settings-options" class="ai-options" :hidden="!state.fields.enabled">
          <label class="ai-check"><input id="ai-settings-autoGrade" :checked="state.fields.autoGrade" :disabled="unavailable" @change="actions.toggle('autoGrade')" type="checkbox">提交答案后自动 AI 评分</label>
          <fieldset class="ai-source" id="ai-settings-source"><legend>评分来源（可同时开启，优先使用免费额度）</legend>
            <label class="ai-check ai-source-row"><input id="ai-settings-useOfficial" :checked="state.fields.useOfficial" :disabled="unavailable" @change="actions.toggle('useOfficial')" type="checkbox"><span>使用免费 AI 额度</span><span
                id="ai-settings-points" class="ai-points" :class="{ empty: points.empty, muted: points.muted }" :hidden="!points.text">{{ points.text }}</span></label>
            <small id="ai-settings-officialHint">评分时，题目、答案和图片会经 QuizForge 服务器发送给模型服务商（通义千问），服务器不保存这些内容。额度用完或暂时不可用时，如果开启了自定义模型，会自动改用自定义模型。</small>
            <label class="ai-check ai-source-row"><input id="ai-settings-useCustom" :checked="state.fields.useCustom" :disabled="unavailable" @change="actions.toggle('useCustom')" type="checkbox"><span>使用自定义模型</span></label>
            <div id="ai-settings-custom" class="ai-custom" :hidden="!state.fields.useCustom"><label>服务地址<input id="ai-settings-baseUrl" :value="state.fields.baseUrl" :disabled="unavailable" @input="actions.edit" type="url" maxlength="500"
                  placeholder="https://服务地址/v1"><small>填写 OpenAI 兼容接口的基础地址，系统会追加
                  /chat/completions。</small></label><label>模型名称<input id="ai-settings-model" :value="state.fields.model" :disabled="unavailable" @input="actions.edit" maxlength="200"
                  placeholder="填写服务提供的模型 ID"></label><label>API Key<input id="ai-settings-apiKey" ref="keyInput" :disabled="unavailable" @input="actions.edit" type="password"
                  maxlength="4096" autocomplete="new-password" placeholder="输入 API Key"><small
                  id="ai-settings-keyHint">{{ keyHint }}</small></label>
              <p>评分内容会发送到所配置的模型服务，结果通过校验后自动保存。测试模型可检测图片识别能力并显示报告。</p>
              <div class="ai-custom-actions"><button id="ai-settings-test" type="button" :disabled="unavailable || !filled" @click="actions.test">{{ state.testing ? '正在测试…' : '测试模型' }}</button><button id="ai-settings-save"
                  type="submit" :disabled="unavailable">{{ state.busy && !state.testing ? '正在保存…' : '保存' }}</button></div><small id="ai-settings-testHint">测试前会保存当前设置，并发送文字与图片测试请求，服务可能计费。</small>
              <section id="ai-settings-report" class="ai-test-report" aria-live="polite" :hidden="!state.report">
                <template v-if="state.report">
                  <h3>模型测试报告</h3><p class="ai-report-summary" :class="state.report.status">{{ state.report.summary || '测试已完成。' }}</p>
                  <ul><li v-for="(check, index) in state.report.checks || []" :key="index"><span class="ai-report-label">{{ check.label || '' }}</span><span class="ai-report-badge" :class="check.status">{{ labels[check.status] || '未知' }}</span><p>{{ check.message || '' }}</p></li></ul>
                  <small class="ai-report-meta">{{ reportMeta(state.report, state.settings?.model || '') }}</small><p v-if="state.report.note" class="ai-report-note">{{ state.report.note }}</p>
                </template>
              </section>
            </div>
          </fieldset>
        </div>
        <p id="ai-settings-error" role="alert" :hidden="!state.error">{{ state.error }}</p>
        <div class="dialog-actions"><button id="ai-settings-close" type="button" @click="actions.close">关闭</button></div>
  </div>
</template>
