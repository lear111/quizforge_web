// DOM handles live with the practice session so saves and iframe callbacks
// keep their lifetime across route changes; the view only supplies containers.
import { nextTick, toRaw } from 'vue';
import { reportOutlineStatus } from '../../../../../shared/v2/answered.js';
import { mountQuestionPage } from '../../services/page';
import type { Picture } from '../../services/page';
import type { Question } from '../../types/practice-types';
import type { PracticeSession } from '../../types/practice-session';

export async function pictures(
  ctx: PracticeSession,
  q: Question,
  has: (id: string) => boolean = () => false,
): Promise<Picture[]> {
  const { api } = ctx;
  const references = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const node = value as { type?: string; attrs?: { src?: unknown } };
    if (node.type === 'image' && typeof node.attrs?.src === 'string') {
      references.add(node.attrs.src);
    }
    Object.values(value).forEach(visit);
  };
  visit(q.question);
  if (q.state.locked) {
    visit(q.solution);
  }
  return (
    await Promise.all(
      q.resources
        .filter((asset) => references.has(asset.reference) && !has(asset.assetId))
        .map(async (asset) => {
          let result: Response;
          try {
            result = await api.questions.asset(q, asset.assetId);
          } catch (error) {
            if ((error as { status?: number }).status === 404) {
              return null;
            }
            throw error;
          }
          const type = result.headers.get('Content-Type')?.split(';')[0] ?? '';
          if (!type.startsWith('image/')) {
            return null;
          }
          return { ...asset, type, bytes: await result.arrayBuffer() };
        }),
    )
  ).filter((asset): asset is Picture => asset !== null);
}

export function disposePage(ctx: PracticeSession) {
  const { saveStatus } = ctx;
  ctx.runtime.generation++;
  ctx.runtime.saver?.destroy();
  ctx.runtime.saver = null;
  ctx.runtime.page?.destroy();
  ctx.runtime.page = null;
  saveStatus.value = '';
  ctx.runtime.answerVersion =
    ctx.runtime.inkVersion =
    ctx.runtime.savedAnswer =
    ctx.runtime.savedInk =
      0;
}

export async function applyContext(ctx: PracticeSession, q: Question) {
  const instance = ctx.runtime.page,
    mine = ctx.runtime.generation;
  ctx.actions().update(q);
  if (instance) {
    const assets = await ctx.actions().pictures(q, (id) => instance.hasResource(id));
    if (mine === ctx.runtime.generation) {
      await instance.update(ctx.actions().context(q), assets);
    }
  }
}

export async function show(ctx: PracticeSession, q: Question, resume = true) {
  const { overview, current, typeName, recovering, busy, message, token } = ctx;
  // Keep the current page and its input intact if fetching the next page fails.
  ctx.runtime.sources!.scope(q.bankId, q.snapshotId, token.value);
  const [loaded, assets] = await Promise.all([
    ctx.runtime.sources!.load(q.extension.artifactId),
    ctx.actions().pictures(q),
  ]);
  ctx.actions().disposePage();
  const mine = ctx.runtime.generation;
  ctx.actions().update(q);
  typeName.value = loaded.name;
  await nextTick();
  if (mine !== ctx.runtime.generation || !ctx.runtime.container) {
    return;
  }
  const instance = mountQuestionPage(
    ctx.runtime.container,
    loaded,
    ctx.actions().context(q),
    ctx.runtime.nonce,
    {
      title: loaded.name,
      resources: assets,
      onChanged(kind, answered) {
        if (mine !== ctx.runtime.generation) {
          return;
        }
        const active = current.value!;
        if (answered !== undefined && !active.state.locked) {
          try {
            ctx.actions().update({
              ...toRaw(active),
              state: {
                ...toRaw(active.state),
                status: reportOutlineStatus(answered, active.item, active.state.status),
              },
            });
          } catch (error) {
            message.value = error instanceof Error ? error.message : '作答状态无效。';
            return;
          }
        }
        ctx.runtime.answerVersion++;
        ctx.runtime.saver?.changed(kind);
      },
      async onSubmit() {
        if (
          mine !== ctx.runtime.generation ||
          busy.value ||
          recovering.value ||
          overview.value?.completedAt ||
          current.value?.state.locked
        ) {
          throw Error('当前不允许提交。');
        }
        await ctx.actions().submit();
      },
      async onRetry() {
        if (
          mine !== ctx.runtime.generation ||
          busy.value ||
          recovering.value ||
          overview.value?.completedAt ||
          !current.value?.state.hasSavedAnswer
        ) {
          throw Error('当前不允许重做。');
        }
        await ctx.actions().retry();
      },
    },
  );
  ctx.runtime.page = instance;
  ctx.runtime.scratch?.load(q.ink);
  ctx.runtime.saver = ctx.actions().createSaver(q, mine, instance);
  await instance.ready;
  ctx.actions().remember(q);
  if (resume && !overview.value?.completedAt && q.submissionId !== null && q.result === null) {
    await ctx.actions().grade(q);
  }
}

export function scopeSources(ctx: PracticeSession, bankId: string, snapshotId: string) {
  const { token } = ctx;
  ctx.runtime.sources?.scope(bankId, snapshotId, token.value);
}

export function resetSources(ctx: PracticeSession) {
  ctx.runtime.sources?.dispose();
}

export function clearQuestion(ctx: PracticeSession, clearInk = false) {
  const { current } = ctx;
  ctx.actions().disposePage();
  current.value = null;
  if (clearInk) {
    ctx.runtime.scratch?.load(null);
  }
}
