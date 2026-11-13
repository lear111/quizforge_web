export type Answered = boolean | Record<string, boolean>;
export const ANSWERED_PART_LIMIT: number;
export function validateAnswered(value: unknown): asserts value is Answered;
export function mergeAnswered(value: unknown, item: { parts?: { id: string }[] }, previous?: Answered): Answered;
