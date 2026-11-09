<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { createChatSession, type ChatRequest } from './session';

const props = defineProps<{ request: ChatRequest }>();
const session = createChatSession(props.request);
const { state } = session;
const log = ref<HTMLElement | null>(null);

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault(); void session.submit();
  }
}
watch(() => state.messages.length, async () => {
  await nextTick();
  if (log.value) log.value.scrollTop = log.value.scrollHeight;
});
onBeforeUnmount(session.dispose);
defineExpose({ cancel: session.cancel });
</script>

<template>
  <div id="ai-chat-log" ref="log" class="ai-chat-log" role="log" aria-label="对话记录" aria-live="polite" :aria-busy="state.busy">
    <p id="ai-chat-empty" class="ai-chat-empty" :hidden="state.messages.length > 0">有什么想一起讨论的？<br>需要分析题目时，请粘贴题目内容。</p>
    <div v-for="message in state.messages" :key="message.id" class="ai-chat-message" :class="`ai-chat-${message.role}`">
      <span class="ai-chat-name">{{ message.role === 'user' ? '你' : 'AI' }}</span>
      <p>{{ message.content }}</p>
    </div>
  </div>
  <form id="ai-chat-form" class="ai-chat-form" @submit.prevent="session.submit()">
    <label for="ai-chat-input" class="visually-hidden">发送给 AI 的消息</label>
    <textarea id="ai-chat-input" v-model="state.draft" rows="3" maxlength="4000" placeholder="输入消息…" aria-describedby="ai-chat-note" @keydown="onKeydown"></textarea>
    <p id="ai-chat-status" class="ai-chat-status" :class="{ 'is-error': state.error }" role="status">{{ state.status }}</p>
    <div class="ai-chat-actions">
      <button id="ai-chat-stop" type="button" :hidden="!state.busy" @click="session.cancel">停止</button>
      <button id="ai-chat-send" type="submit" :disabled="state.busy || !state.draft.trim()">发送</button>
    </div>
    <p id="ai-chat-note" class="ai-chat-note">使用设置中的 AI 调用来源，会消耗对应额度。对话仅保留在当前页面，刷新后清空。</p>
  </form>
</template>
