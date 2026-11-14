export interface OutlineResult { score?: number | null; maxScore?: number | null; gradingStatus?: string }
export interface ChildState { id: string; status: string }
export interface OutlineState { status?: string; result?: OutlineResult | null; outlineStates?: ChildState[] }
export interface OutlineRound extends OutlineResult { submitted?: boolean; status?: string; answerState?: { status?: string }; outlineStates?: ChildState[] }
export interface OutlineQuestion {
  id: string; title: string; label: string; children: { id: string; label: string }[];
  state: OutlineState; round?: OutlineRound;
}
export interface OutlineInput {
  groups: { key: string; name: string; questions: OutlineQuestion[] }[];
  questionId?: string | null; itemId?: string | null; summaryShown: boolean; summaryAvailable: boolean;
}
export interface OutlineButton { key: string; questionId: string; itemId: string | null; label: unknown; status: string; active: boolean; title: string; ariaLabel: string }
export interface OutlineModel { groups: { key: string; name: unknown; buttons: OutlineButton[] }[]; summaryShown: boolean; summaryAvailable: boolean }
const labels: Record<string, string> = { unanswered: '未作答', draft: '已作答，待提交', pending: '已提交，待评分', correct: '正确', incorrect: '错误' };

// Input contains display fields only. Answers, ink, live panes and iframe
// instances stay in the host and never become reactive component state.
export function buildOutlineModel(input: OutlineInput): OutlineModel {
  return {
    summaryShown: input.summaryShown, summaryAvailable: input.summaryAvailable,
    groups: input.groups.map(group => ({ key: group.key, name: group.name, buttons: group.questions.flatMap<OutlineButton>(row => {
      const { state, round } = row, submitted = round ? round.submitted === true : state.status === 'submitted';
      if (row.children.length) {
        const details = Array.isArray(round?.outlineStates) ? round.outlineStates : round && !round.submitted && state.status === 'submitted' ? [] : state.outlineStates;
        const states = new Map((Array.isArray(details) ? details : []).filter(item => typeof item?.id === 'string' && Object.hasOwn(labels, item.status)).map(item => [item.id, item.status]));
        return row.children.map(item => {
          const reported = states.get(item.id), status = submitted ? (reported === 'draft' ? '' : reported || '') : reported === 'draft' ? 'draft' : 'unanswered';
          const statusLabel = labels[status] || '未提供小题状态';
          return { key: JSON.stringify([row.id, item.id]), questionId: row.id, itemId: item.id, label: item.label, status,
            active: row.id === input.questionId && item.id === input.itemId,
            title: `第 ${row.label} 题 · ${item.label} · ${statusLabel}`, ariaLabel: `第 ${row.label} 题，小题 ${item.label}：${statusLabel}` };
        });
      }
      const result = round || state.result, draft = (round ? round.answerState?.status ?? round.status : state.status) === 'draft';
      const status = !submitted ? (draft ? 'draft' : 'unanswered') : result?.gradingStatus === 'pending' ? 'pending' : Number.isFinite(result?.score) && Number.isFinite(result?.maxScore) && result?.score === result?.maxScore ? 'correct' : 'incorrect';
      return [{ key: JSON.stringify([row.id, null]), questionId: row.id, itemId: null, label: row.label, status, active: row.id === input.questionId,
        title: `第 ${row.label} 题 · ${row.title} · ${labels[status]}`, ariaLabel: `第 ${row.label} 题：${row.title}，${labels[status]}` }];
    }) })),
  };
}
