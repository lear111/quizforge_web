import { toRaw } from 'vue';
import { answeredFromStatus } from '../../../../../../shared/v2/answered.js';
import type { PracticeSession, QuestionPage } from '../../../types/practice-session';
import type { AnswerFields, SaveSnapshot } from './types';

export async function readDraft(
  ctx: PracticeSession,
  instance: QuestionPage,
): Promise<SaveSnapshot> {
  const active = ctx.current.value!,
    av = ctx.runtime.answerVersion,
    iv = ctx.runtime.inkVersion;
  let fields: AnswerFields | null = null;
  if (!active.readOnly && av > ctx.runtime.savedAnswer) {
    const answer = active.state.locked ? undefined : await instance.answer();
    if (!active.state.locked) {
      fields = { answer, answered: answeredFromStatus(toRaw(active.state.status)) };
    }
  }
  return {
    fields,
    ink: iv > ctx.runtime.savedInk ? ctx.runtime.scratch?.getDraft() : undefined,
    av,
    iv,
  };
}
