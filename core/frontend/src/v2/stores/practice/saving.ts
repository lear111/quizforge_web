import { toRaw } from 'vue';
import type { AnswerRequest, InkResponse, QuestionResponse } from '../../../../../shared/v2/api.js';
import { answeredFromStatus } from '../../../../../shared/v2/answered.js';
import { createSaveController, isSaveConflict } from '../../services/save-policy';
import type { Question } from '../../types/practice-types';
import type { QuestionPage } from '../../types/practice-session';
import type { PracticeSession } from '../../types/practice-session';

export function createSaver(
  ctx: PracticeSession,
  q: Question,
  mine: number,
  instance: QuestionPage,
) {
  const { current, saveStatus, message, api } = ctx;
  return createSaveController<Record<string, unknown>>({
    async read() {
      const active = current.value!,
        av = ctx.runtime.answerVersion,
        iv = ctx.runtime.inkVersion;
      const fields: Record<string, unknown> = {};
      if (av > ctx.runtime.savedAnswer) {
        const answer = active.state.locked ? undefined : await instance.answer();
        if (!active.state.locked) {
          fields.answer = answer;
          fields.answered = answeredFromStatus(toRaw(active.state.status));
        }
      }
      return {
        fields,
        ink: iv > ctx.runtime.savedInk ? ctx.runtime.scratch?.getDraft() : undefined,
        av,
        iv,
      };
    },
    prepare(value) {
      const fields = value.fields as Record<string, unknown>,
        av = value.av as number,
        iv = value.iv as number;
      const operation = (
        kind: 'answer' | 'ink',
        fields: Record<string, unknown>,
        done: () => void,
      ) =>
        ctx.runtime.queue.prepare(
          () => {
            const active = current.value!;
            return kind === 'ink'
              ? api.questions.prepareInk(active, fields.ink)
              : api.questions.prepareAnswer(
                  active,
                  fields as Pick<AnswerRequest, 'answer' | 'answered'>,
                );
          },
          api.questions.sendSave,
          (saved: QuestionResponse | InkResponse) => {
            if (mine === ctx.runtime.generation) {
              done();
              ctx.actions().update(
                kind === 'ink'
                  ? {
                      ...toRaw(current.value!),
                      ink: value.ink,
                      inkRevision: (saved as InkResponse).inkRevision,
                      state: saved.state,
                    }
                  : (saved as QuestionResponse),
                ctx.runtime.answerVersion > ctx.runtime.savedAnswer,
              );
            }
          },
        );
      const answer = Object.keys(fields).length
        ? operation('answer', fields, () => {
            ctx.runtime.savedAnswer = av;
          })
        : async () => {
            ctx.runtime.savedAnswer = av;
          };
      const ink =
        value.ink !== undefined
          ? operation('ink', { ink: value.ink }, () => {
              ctx.runtime.savedInk = iv;
            })
          : async () => {};
      let answerDone = false;
      return async () => {
        if (!answerDone) {
          await answer();
          answerDone = true;
        }
        // Repaint only when the saved draft changes button permissions. Stop
        // new user input first, then round-trip the getters to drain older
        // changed messages. A newer edit cancels this repaint and saves next.
        if (
          mine === ctx.runtime.generation &&
          av === ctx.runtime.answerVersion &&
          !current.value!.state.locked &&
          instance.can.retry !== ctx.actions().context(current.value!).can.retry
        ) {
          instance.frame.inert = true;
          try {
            await instance.answer();
            if (mine === ctx.runtime.generation && av === ctx.runtime.answerVersion) {
              await instance.update(ctx.actions().context(current.value!));
            }
          } finally {
            instance.frame.inert = false;
          }
        }
        await ink();
      };
    },
    recovery: {
      accepts: isSaveConflict,
      reload: async (error) => {
        await ctx.actions().reloadAfterConflict(q, mine, error);
        ctx.runtime.savedAnswer = ctx.runtime.answerVersion;
        ctx.runtime.savedInk = ctx.runtime.inkVersion;
      },
    },
    status(value) {
      if (mine === ctx.runtime.generation) {
        saveStatus.value = {
          unsaved: '未保存',
          saving: '正在保存',
          saved: '已保存',
          failed: '保存失败',
          recovered: '已载入最新内容',
        }[value];
        if (value === 'saved') {
          message.value = '';
        }
      }
    },
    error(error) {
      if (mine === ctx.runtime.generation) {
        message.value = error instanceof Error ? error.message : '保存失败，请重试。';
      }
    },
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
