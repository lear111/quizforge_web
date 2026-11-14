<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import LibraryList from '../library/LibraryList.vue';
import OutlinePanel from '../outline/OutlinePanel.vue';
import type { LibraryTree } from '../library/types';
import { buildV2Outline } from './outline';
import PracticePage from './PracticePage.vue';
import FinalScore from './FinalScore.vue';
import type { Overview, PracticeWorkspace, Question } from './practice-types';
import './workspace.css';

defineProps<{ nonce: string }>();
const groups = ref<LibraryTree[]>([]),
  overview = ref<Overview | null>(null);
const busy = ref(false),
  message = ref(''),
  loading = ref(''),
  drawer = ref<'library' | 'outline' | null>(null),
  token = ref(''),
  authRequired = ref(false);
const scoreView = ref(false);
const practice = ref<InstanceType<typeof PracticePage>>();
const current = computed(() => practice.value?.current);
const recovering = computed(() => practice.value?.recovering ?? false);
const drafting = computed(() => practice.value?.drafting ?? false);
const requestPrefix = (id: string) => `/api/v2/banks/${id}`;
const LAST_BANK = 'quizforge.v2.last-bank';
const lastQuestions = new Map<string, string>();
function remember(q: Question) {
  lastQuestions.delete(q.bankId);
  lastQuestions.set(q.bankId, q.questionId);
  while (lastQuestions.size > 8) {
    lastQuestions.delete(lastQuestions.keys().next().value!);
  }
  try {
    localStorage.setItem(LAST_BANK, q.bankId);
  } catch {
    /* Storage disabled: last answered position still works. */
  }
}
async function response(route: string, options: RequestInit = {}) {
  const response = await fetch(route, {
    ...options,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { ...options.headers, ...(token.value ? { 'x-quizforge-token': token.value } : {}) },
  });
  if (!response.ok) {
    const body = await response.json();
    if (response.status === 401) {
      authRequired.value = true;
      practice.value?.resetSources();
    }
    throw Object.assign(new Error(body.error?.message || '操作未完成。'), {
      code: body.error?.code,
      questionId: body.error?.questionId,
      status: response.status,
    });
  }
  return response;
}
const json = async (route: string, options?: RequestInit) =>
  (await response(route, options)).json();
const outlineModel = computed(() =>
  buildV2Outline(
    overview.value?.outline ?? [],
    overview.value?.states ?? [],
    current.value?.questionId,
  ),
);
async function run(label: string, action: () => Promise<void>) {
  if (busy.value) {
    return;
  }
  busy.value = true;
  loading.value = label;
  message.value = '';
  try {
    await action();
  } catch (error) {
    message.value = error instanceof Error ? error.message : '操作未完成。';
  } finally {
    busy.value = false;
    loading.value = '';
  }
}
async function catalog() {
  await run('正在读取题库', async () => {
    const value = await json('/api/v2/catalog');
    authRequired.value = false;
    groups.value = value.groups.map(
      (g: {
        id: string;
        name: string;
        items: { bankId: string; title: string; error: { message: string } | null }[];
      }) => ({
        kind: 'group',
        path: g.id,
        name: g.name,
        expanded: false,
        children: g.items.map((row) => ({
          kind: 'extension',
          row: { id: row.bankId, title: row.title, kind: 'bank', error: row.error ?? undefined },
        })),
      }),
    );
  });
}
async function openBank(_kind: string, id?: string) {
  if (!id) {
    return;
  }
  await run('正在打开题库', async () => {
    const page = practice.value;
    if (!page) {
      return;
    }
    await page.flush();
    const value: Overview = await json(`${requestPrefix(id)}/overview`);
    const remembered = lastQuestions.get(id);
    const initial =
      remembered &&
      value.states.some((state) => state.questionId === remembered) &&
      remembered !== value.initial.question?.questionId
        ? ((await json(
            `${requestPrefix(id)}/questions/${encodeURIComponent(remembered)}?snapshotId=${value.snapshotId}`,
          )) as Question)
        : value.initial.question;
    const previous = overview.value,
      previousScoreView = scoreView.value;
    page.resetSources();
    page.scopeSources(value.bank.bankId, value.snapshotId);
    overview.value = value;
    scoreView.value = !!value.completedAt;
    drawer.value = null;
    if (initial) {
      try {
        await page.show(initial, false);
      } catch (error) {
        if (current.value?.bankId !== value.bank.bankId) {
          overview.value = previous;
          await nextTick();
          scoreView.value = previousScoreView;
        }
        throw error;
      }
    } else {
      page.clearQuestion();
      message.value = value.initial.error?.message ?? '题库没有题目。';
    }
    if (value.notice) {
      message.value = value.notice;
    }
    await page.recoverPending(value);
  });
}
async function navigate(id: string) {
  const page = practice.value;
  if (!page || !overview.value) {
    return;
  }
  if (id === current.value?.questionId && !page.pageFaulted()) {
    if (!busy.value) {
      scoreView.value = false;
      drawer.value = null;
    }
    return;
  }
  await run('正在打开题目', async () => {
    await page.flush();
    const bank = overview.value;
    if (!bank) {
      return;
    }
    await page.show(
      await json(
        `${requestPrefix(bank.bank.bankId)}/questions/${encodeURIComponent(id)}?snapshotId=${bank.snapshotId}`,
      ),
    );
    scoreView.value = false;
    drawer.value = null;
  });
}
async function refreshBank() {
  if (!overview.value) {
    return;
  }
  await run('正在刷新题库', async () => {
    const page = practice.value;
    if (!page) {
      return;
    }
    await page.flush();
    const active = current.value,
      bank = overview.value!;
    const value: Overview = await json(`${requestPrefix(bank.bank.bankId)}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(active ? { questionId: active.questionId } : {}) }),
    });
    overview.value = value;
    scoreView.value = !!value.completedAt;
    page.resetSources();
    if (value.notice) {
      message.value = value.notice;
    }
    if (value.initial.question) {
      await page.show(value.initial.question);
    } else {
      page.clearQuestion(true);
    }
  });
}
watch(
  () => overview.value?.completedAt,
  (value) => {
    scoreView.value = !!value;
  },
);
async function finishPractice() {
  if (
    !overview.value ||
    busy.value ||
    !confirm('完成练习后，答案将锁定，未作答题记 0 分。确定完成吗？')
  ) {
    return;
  }
  await practice.value?.complete();
}
const workspace: PracticeWorkspace = {
  overview,
  message,
  busy,
  token,
  response,
  json,
  run,
  remember,
};
onMounted(async () => {
  await catalog();
  try {
    const id = localStorage.getItem(LAST_BANK);
    if (
      id &&
      groups.value.some(
        (group) =>
          group.kind === 'group' &&
          group.children.some((row) => row.kind === 'extension' && row.row.id === id),
      )
    ) {
      await openBank('bank', id);
    }
  } catch {
    /* Private/disabled storage. */
  }
});
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
        :on-toggle-group="
          (id) => {
            const group = groups.find((g) => g.kind === 'group' && g.path === id);
            if (group?.kind === 'group') group.expanded = !group.expanded;
          }
        "
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
            @click="practice?.toggleDraft()"
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
            @click="scoreView = true"
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
        @view="scoreView = false"
        @grade="practice?.resumeCompletion()"
      />
      <PracticePage
        ref="practice"
        :visible="!scoreView"
        :nonce="nonce"
        :request-prefix="requestPrefix"
        :workspace="workspace"
        :busy="busy"
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
