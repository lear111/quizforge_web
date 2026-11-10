export interface SummaryValue {
  score?: unknown; maxScore?: unknown; questionCount?: unknown; submittedCount?: unknown; pendingCount?: unknown;
  finished?: unknown; historyId?: unknown; completionPending?: unknown; completionError?: unknown; answeredUnsubmittedCount?: unknown;
  [key: string]: unknown;
}
export interface SummaryConfig {
  summary: SummaryValue | null | undefined;
  readonly?: boolean; history?: boolean; exam?: boolean;
  onFinish?(value: SummaryValue | null | undefined): unknown;
  onRestart?(value: SummaryValue | null | undefined): unknown;
  isCurrent(): boolean;
}
const format = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 });
const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function model(value: SummaryValue | null | undefined, config: SummaryConfig, busy: boolean, error: string) {
  const count = Math.max(0, Math.trunc(numeric(value?.questionCount)));
  const done = Math.min(count, Math.max(0, Math.trunc(numeric(value?.submittedCount))));
  const awaiting = Math.max(0, Math.trunc(numeric(value?.pendingCount)));
  const finished = !!value?.finished, restart = typeof config.onRestart === 'function';
  return {
    badge: config.exam ? '考试汇总' : config.readonly ? '历史汇总' : '分值汇总',
    title: config.exam ? finished ? '考试结果' : '考试评分' : finished ? '练习结果' : '本轮练习',
    intro: config.exam ? '查看本次考试的分值统计。' : config.readonly ? '查看这轮练习保存的分值统计。' : '全部题目的分值汇总在这里。',
    earned: format.format(numeric(value?.score)), maximum: format.format(numeric(value?.maxScore)),
    submitted: `已提交 ${done} 题`, pending: `未提交 ${count - done} 题`, grading: `待评分 ${awaiting} 题`, gradingHidden: !awaiting,
    scoreLabel: awaiting ? '已评分得分 / 总分' : config.exam ? '考试得分 / 总分' : '本轮得分 / 总分',
    note: String(config.exam ? `交卷后答案已锁定。${awaiting ? '部分题目仍待评分。' : ''}` : config.readonly ? '此页为只读历史汇总。' : finished ? value?.historyId ? '本轮结果已保存到历史记录。' : '本轮练习已完成，结果仅在当前会话保留。' : value?.completionPending ? value.completionError || '答案已提交，AI 评分尚未完成。可返回题目查看进度或人工评分，再完成练习。' : awaiting ? '答案已提交，部分题目待评分。请返回题目重试 AI 或人工评分，再完成练习。' : value?.answeredUnsubmittedCount ? `还有 ${value.answeredUnsubmittedCount} 道已作答题目未提交，完成练习时统一提交评分；未作答题目计 0 分。` : config.history === false ? '结果仅在当前会话保留，刷新或关闭页面后清除。' : '完成练习后保留本轮结果。'),
    buttonVisible: !config.readonly,
    buttonDisabled: busy || (finished ? !restart : awaiting > 0 && !value?.answeredUnsubmittedCount || typeof config.onFinish !== 'function'),
    buttonLabel: finished ? busy ? '正在开始…' : restart ? '再练一次' : '练习已完成' : busy ? '正在完成…' : '完成练习',
    busy, error,
  };
}
export type SummaryModel = ReturnType<typeof model>;

// Only display fields go to Vue. The original summary (round/version IDs and
// any additional host data) stays here and is passed unchanged to host actions.
export function createPracticeSummary(config: SummaryConfig, render: (value: SummaryModel) => void) {
  let current = config.summary, busy = false, destroyed = false, revision = 0, error = '';
  const publish = () => { if (!destroyed) render(model(current, config, busy, error)); };
  return {
    initialize: publish,
    update(next: SummaryValue | null | undefined) { if (destroyed) return; current = next; ++revision; publish(); },
    async finish() {
      const restarting = !!current?.finished, action = restarting ? config.onRestart : config.onFinish;
      if (destroyed || config.readonly || busy || !config.isCurrent() || model(current, config, false, '').buttonDisabled || typeof action !== 'function') return;
      const captured = revision; busy = true; error = ''; publish();
      try {
        const next = await action(current);
        if (!destroyed && config.isCurrent() && revision === captured && next) current = next as SummaryValue;
      } catch (cause) {
        if (destroyed || !config.isCurrent()) return;
        error = String((cause as { message?: unknown } | null)?.message || (restarting ? '开始新一轮失败，请重试。' : '完成练习失败，请重试。'));
      } finally { busy = false; publish(); }
    },
    destroy() { destroyed = true; },
  };
}
