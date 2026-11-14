<script setup lang="ts">
import { onMounted } from 'vue';
import { useWorkspaceNavigation } from '../router/injection';
import { storeToRefs } from 'pinia';
import LibraryList from '../../library/LibraryList.vue';
import OutlinePanel from '../../outline/OutlinePanel.vue';
import PracticePage from './PracticePage.vue';
import FinalScore from '../components/FinalScore.vue';
import { usePracticeStore } from '../stores/practice';
import { useCatalogStore } from '../stores/catalog';
import { useUiStore } from '../stores/ui';
import '../styles/workspace.css';

defineProps<{ nonce: string }>();
const practice = usePracticeStore(),
  catalogStore = useCatalogStore();
const { groups } = storeToRefs(catalogStore);
const { overview, current, recovering, drafting, outlineModel } = storeToRefs(practice);
const { busy, message, loading, drawer, token, authRequired, scoreView } =
  storeToRefs(useUiStore());
const { refreshBank, finishPractice } = practice;
const navigation = useWorkspaceNavigation();
const { catalog, openBank, navigate, showSummary, showQuestion } = navigation;
onMounted(navigation.start);
</script>
<template>
  <div class="v2-app">
    <header class="v2-mobile">
      <strong>QuizForge</strong
      ><button @click="drawer = drawer === 'library' ? null : 'library'">题库</button
      ><button @click="drawer = drawer === 'outline' ? null : 'outline'">大纲</button>
    </header>
    <aside
      class="v2-library"
      :class="{ open: drawer === 'library' }"
    >
      <div class="v2-brand">
        <span>Q</span>
        <div><strong>QuizForge</strong><small>你的练习空间 · V2</small></div>
      </div>
      <h2>我的题库</h2>
      <form
        v-if="authRequired"
        @submit.prevent="catalog"
      >
        <label
          >连接令牌<input
            v-model="token"
            type="password"
            autocomplete="off" /></label
        ><button>连接</button>
      </form>
      <LibraryList
        :groups="groups"
        mode="bank"
        :active-key="overview ? `bank:${overview.bank.bankId}` : null"
        :can-manage="false"
        empty-message="暂无 V2 题库"
        :on-open="openBank"
        :on-toggle-group="catalogStore.toggleGroup"
        :on-notice="(text) => (message = text)"
        :on-manage="() => {}"
      />
    </aside>
    <main class="v2-main">
      <header>
        <h1>{{ overview?.bank.title ?? '选择一本题库' }}</h1>
        <span
          v-if="loading"
          role="status"
          >{{ loading }}</span
        >
        <div class="v2-actions">
          <button
            v-if="current && !scoreView"
            :disabled="busy || recovering"
            @click="practice.toggleDraft()"
          >
            {{ drafting ? '返回作答' : '草稿' }}</button><button
            v-if="overview && !overview.completedAt"
            :disabled="busy || recovering"
            @click="finishPractice"
          >
            完成练习</button
          ><button
            v-if="overview?.completedAt && !scoreView"
            :disabled="busy || recovering"
            @click="showSummary"
          >
            最终得分</button
          ><button
            v-if="overview"
            :disabled="busy || recovering"
            @click="refreshBank"
          >
            刷新题库
          </button>
        </div>
      </header>
      <p
        v-if="message"
        class="v2-error"
        role="alert"
      >
        {{ message }}
      </p>
      <FinalScore
        v-if="overview && scoreView"
        :value="overview"
        :busy="busy"
        @view="showQuestion"
        @grade="practice.resumeCompletion()"
      />
      <PracticePage
        :visible="!scoreView"
        :nonce="nonce"
      />
    </main>
    <aside
      class="v2-outline"
      :class="{ open: drawer === 'outline' }"
    >
      <h2>题目大纲</h2>
      <OutlinePanel
        :model="outlineModel"
        :on-navigate="navigate"
        :on-summary="() => {}"
      />
    </aside>
  </div>
</template>
