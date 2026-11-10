<script setup lang="ts">
import { computed, ref } from 'vue';
import { balance, type UserActions, type UserState } from './account';
const props = defineProps<{ state: UserState; actions: UserActions }>();
const codeInput = ref<HTMLInputElement | null>(null);
const unavailable = computed(() => props.state.busy || !props.state.account);
defineExpose({ readCode: () => codeInput.value?.value || '', clearCode() { if (codeInput.value) codeInput.value.value = ''; } });
</script>
<template>
  <div class="user-center">
      <p id="user-center-status" class="network-settings-hint" role="status" :hidden="!state.status">{{ state.status }}</p>
      <div id="user-center-account" class="user-center-account" :hidden="!state.account?.connected">
        <div class="user-center-who"><span id="user-center-avatar" class="user-center-avatar" aria-hidden="true">{{ Array.from(state.account?.user?.name || '')[0] || 'Q' }}</span><span><strong
              id="user-center-name">{{ state.account?.user?.name || '' }}</strong><small id="user-center-device">这台电脑：{{ state.account?.device?.name || '' }}</small></span></div>
        <div class="user-center-points"><small>免费 AI 额度</small><strong id="user-center-points" :class="{ empty: state.account?.ai && state.account.ai.balance < 1 }">{{ balance(state.account) }}</strong></div>
        <form id="user-center-redeem" class="user-center-redeem" @submit.prevent="actions.redeem"><label for="user-center-code">兑换码</label><div><input id="user-center-code" ref="codeInput" :disabled="unavailable" @input="actions.editCode"
              maxlength="64" autocomplete="off" spellcheck="false" placeholder="AI-XXXX-XXXX-XXXX-XXXX"><button id="user-center-redeem-submit"
              type="submit" :disabled="unavailable">{{ state.busy ? '正在处理…' : '兑换' }}</button></div><small id="user-center-redeem-result" role="status" :class="{ error: state.resultError }">{{ state.result }}</small></form>
        <div class="user-center-actions"><a id="user-center-manage" :hidden="!state.account?.manageUrl" :href="state.account?.manageUrl" target="_blank" rel="noopener">在题库广场管理设备</a><button
            id="user-center-refresh" :disabled="unavailable" @click="actions.refresh" type="button">刷新</button><button id="user-center-logout" :disabled="unavailable" @click="actions.logout" type="button">退出登录</button></div>
      </div>
      <div id="user-center-guest" class="user-center-guest" :hidden="!state.account || state.account.connected">
        <p>登录 QuizForge 账号后，可以使用免费 AI 额度评分，并用兑换码获取额度。登录只用于免费 AI 额度，题库和作答仍只保存在这台电脑上。</p>
        <button id="user-center-login" :disabled="unavailable" @click="actions.login" type="button">登录 QuizForge 账号</button>
      </div>
      <p id="user-center-error" class="network-settings-error" role="alert" :hidden="!state.error">{{ state.error }}</p>
      <div class="user-center-help"><button id="user-center-contact" type="button" :hidden="!state.account" @click="actions.contact">联系管理员</button></div>
      <div class="dialog-actions"><button id="user-center-close" type="button" @click="actions.close">关闭</button></div>
  </div>
</template>
