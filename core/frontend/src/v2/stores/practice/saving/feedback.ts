import { isSaveConflict } from '../../../services/save-policy';
import type { PracticeSession } from '../../../types/practice-session';
import type { Question } from '../../../types/practice-types';

export function recovery(ctx: PracticeSession, q: Question, mine: number) {
  return {
    accepts: isSaveConflict,
    reload: async (error: unknown) => {
      await ctx.actions().reloadAfterConflict(q, mine, error);
      ctx.runtime.savedAnswer = ctx.runtime.answerVersion;
      ctx.runtime.savedInk = ctx.runtime.inkVersion;
    },
  };
}

export function feedback(ctx: PracticeSession, mine: number) {
  return {
    status(value: 'unsaved' | 'saving' | 'saved' | 'failed' | 'recovered') {
      if (mine === ctx.runtime.generation) {
        ctx.saveStatus.value = {
          unsaved: '未保存',
          saving: '正在保存',
          saved: '已保存',
          failed: '保存失败',
          recovered: '已载入最新内容',
        }[value];
        if (value === 'saved') {
          ctx.message.value = '';
        }
      }
    },
    error(error: unknown) {
      if (mine === ctx.runtime.generation) {
        ctx.message.value = error instanceof Error ? error.message : '保存失败，请重试。';
      }
    },
  };
}
