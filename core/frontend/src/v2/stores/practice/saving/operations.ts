import { toRaw } from 'vue';
import type { SavedOperation } from '../../../types/save';
import type { PracticeSession } from '../../../types/practice-session';
import type { SaveOperation, SaveSnapshot } from './types';

function applySaved(
  ctx: PracticeSession,
  mine: number,
  snapshot: SaveSnapshot,
  saved: SavedOperation,
) {
  if (mine !== ctx.runtime.generation) {
    return;
  }
  if (saved.kind === 'ink') {
    ctx.runtime.savedInk = snapshot.iv;
  } else {
    ctx.runtime.savedAnswer = snapshot.av;
  }
  ctx.actions().update(
    saved.kind === 'ink'
      ? {
          ...toRaw(ctx.current.value!),
          ink: snapshot.ink,
          inkRevision: saved.value.inkRevision,
          state: saved.value.state,
        }
      : saved.value,
    ctx.runtime.answerVersion > ctx.runtime.savedAnswer,
  );
}

export function prepareOperation(
  ctx: PracticeSession,
  mine: number,
  snapshot: SaveSnapshot,
  operation: SaveOperation,
) {
  const { questions } = ctx.api;
  // Observe the current revision only when this operation reaches the queue head.
  const currentQuestion = () => ctx.current.value!;
  if (operation.kind === 'ink') {
    return ctx.runtime.queue.prepare(
      () => questions.prepareInk(currentQuestion(), operation.ink),
      (request) => questions.sendSave(request),
      (value) => applySaved(ctx, mine, snapshot, { kind: 'ink', value }),
    );
  }
  return ctx.runtime.queue.prepare(
    () => questions.prepareAnswer(currentQuestion(), operation.fields),
    (request) => questions.sendSave(request),
    (value) => applySaved(ctx, mine, snapshot, { kind: 'answer', value }),
  );
}
