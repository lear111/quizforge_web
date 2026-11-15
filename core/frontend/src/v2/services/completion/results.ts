import type { ResultEntry } from '../../../../../shared/v2/api.js';
import type { GradingInput, GradingOutput } from '../grading';
import { ungradable } from '../grading';
import type { Overview, Question } from '../../types/practice-types';

export function groupQuestions(candidates: Overview['pendingGrading']) {
  const groups = new Map<string, Question[]>();
  for (const candidate of candidates) {
    if (candidate.question) {
      const q = candidate.question,
        id = q.extension.artifactId;
      if (!groups.has(id)) {
        groups.set(id, []);
      }
      groups.get(id)!.push(q);
    }
  }
  return groups;
}

export function gradingInputs(questions: Question[]): GradingInput[] {
  return questions.map((q) => ({
    questionId: q.questionId,
    question: q.question,
    solution: q.solution,
    answer: q.answer,
    item: q.item,
  }));
}

export function appendResults(
  rows: ResultEntry[],
  questions: Question[],
  graded: GradingOutput[],
): void {
  for (const q of questions) {
    rows.push({
      questionId: q.questionId,
      submissionId: q.submissionId!,
      expectedRevision: q.state.revision,
      result:
        graded.find((row) => row.questionId === q.questionId)?.result ??
        ungradable('题型没有返回本题的评分结果。'),
    });
  }
}
