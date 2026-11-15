import { createSaveController } from '../../services/save-policy';
import type { Question } from '../../types/practice-types';
import type { PracticeSession, QuestionPage } from '../../types/practice-session';
import { readDraft } from './saving/capture';
import { prepareDraft } from './saving/prepare';
import { feedback, recovery } from './saving/feedback';

export function createSaver(
  ctx: PracticeSession,
  q: Question,
  mine: number,
  instance: QuestionPage,
) {
  return createSaveController({
    read: () => readDraft(ctx, instance),
    prepare: (value) => prepareDraft(ctx, mine, instance, value),
    recovery: recovery(ctx, q, mine),
    ...feedback(ctx, mine),
  });
}

export async function flush(ctx: PracticeSession) {
  ctx.runtime.scratch?.flush();
  await ctx.runtime.saver?.flush();
  await ctx.runtime.queue.drain();
}

export function retrySave(ctx: PracticeSession) {
  return ctx.run('正在保存', ctx.actions().flush);
}
