import type { PracticeSession, QuestionPage } from '../../../types/practice-session';
import { prepareOperation } from './operations';
import type { SaveSnapshot } from './types';

function needsRepaint(ctx: PracticeSession, mine: number, instance: QuestionPage, av: number) {
  return (
    mine === ctx.runtime.generation &&
    av === ctx.runtime.answerVersion &&
    !ctx.current.value!.state.locked &&
    instance.can.retry !== ctx.actions().context(ctx.current.value!).can.retry
  );
}

function prepareStages(ctx: PracticeSession, mine: number, snapshot: SaveSnapshot) {
  const answer = snapshot.fields
    ? prepareOperation(ctx, mine, snapshot, { kind: 'answer', fields: snapshot.fields })
    : async () => {
        ctx.runtime.savedAnswer = snapshot.av;
      };
  const ink =
    snapshot.ink !== undefined
      ? prepareOperation(ctx, mine, snapshot, { kind: 'ink', ink: snapshot.ink })
      : async () => {};
  return { answer, ink };
}

export function prepareDraft(
  ctx: PracticeSession,
  mine: number,
  instance: QuestionPage,
  snapshot: SaveSnapshot,
) {
  const { answer, ink } = prepareStages(ctx, mine, snapshot);
  let answerDone = false;
  let lateAnswer: unknown;
  return async () => {
    if (!answerDone) {
      try {
        await answer();
      } catch (error) {
        if ((error as { code?: string } | null)?.code !== 'EXAM_ENDED') {
          throw error;
        }
        lateAnswer = error;
      }
      answerDone = true;
    }
    if (needsRepaint(ctx, mine, instance, snapshot.av)) {
      // Stop new input, then drain older changed messages via the getter.
      // A newer edit cancels this repaint and is saved by the next iteration.
      instance.frame.inert = true;
      try {
        await instance.answer();
        if (mine === ctx.runtime.generation && snapshot.av === ctx.runtime.answerVersion) {
          await instance.update(ctx.actions().context(ctx.current.value!));
        }
      } finally {
        instance.frame.inert = false;
      }
    }
    await ink();
    if (lateAnswer) {
      throw lateAnswer;
    }
  };
}
