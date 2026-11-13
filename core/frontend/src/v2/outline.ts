import type { Answered } from '../../../shared/v2/answered.js';
import type { OutlineModel } from '../outline/model';
export interface Item { id: string; label?: string; maxScore?: number; parts?: { id: string; label: string; maxScore: number }[] }
export interface State { questionId: string; revision: number; resultRevision: number; status: string; locked: boolean; score: number | null; maxScore: number; answered?: Answered; outlineScores?: { id: string; score: number }[] }
const labels: Record<string, string> = { unanswered: '未作答', draft: '已作答，待提交', pending: '已提交，待评分', correct: '正确', incorrect: '错误' };
export function buildV2Outline(groups: { title: string; items: Item[] }[], states: State[], currentId?: string): OutlineModel {
  const byId = new Map(states.map(state => [state.questionId, state]));
  return { summaryAvailable: false, summaryShown: false, groups: groups.map((group, index) => ({ key: String(index), name: group.title, buttons: group.items.flatMap(item => {
    const state = byId.get(item.id);
    return (item.parts ?? [{ id: null, label: item.label ?? item.id, maxScore: item.maxScore! }]).map(part => {
      const score = part.id === null ? state?.score : state?.outlineScores?.find(score => score.id === part.id)?.score;
      const answered = part.id === null ? state?.answered === true : typeof state?.answered === 'object' && state.answered[part.id] === true;
      const status = state?.status === 'graded' ? (score === part.maxScore ? 'correct' : 'incorrect') : state?.locked ? 'pending' : answered ? 'draft' : 'unanswered';
      return { key: `${item.id}:${part.id}`, questionId: item.id, itemId: part.id, label: part.label, status, active: currentId === item.id, title: `第 ${part.label} 题 · ${labels[status]}`, ariaLabel: `第 ${part.label} 题：${labels[status]}` };
    });
  }) })) };
}
