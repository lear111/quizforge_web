import type { GradingInput, GradingOutput } from './grading';
import { ungradable } from './grading';

export async function saveGrade<T>(input: GradingInput,
  grade: (items: GradingInput[]) => Promise<GradingOutput[]>,
  save: (result: unknown) => Promise<T>): Promise<T> {
  const [output] = await grade([input]);
  try { return await save(output.result); }
  catch (error) {
    // Only a server-rejected grading payload is converted. Connection/version
    // failures remain pending so the current locked answer can be retried.
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'INVALID_RESULT') throw error;
    return save(ungradable('题型返回的评分格式或分数无效。'));
  }
}

export async function recoverGrades<T>(questions: T[], score: (question: T) => Promise<T>,
  saved: (question: T) => Promise<void>, failed: (error: unknown) => void) {
  for (const question of questions) {
    try { await saved(await score(question)); }
    catch (error) { failed(error); }
  }
}
