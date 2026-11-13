export type Answered = boolean | Record<string, boolean>;
export const ANSWERED_PART_LIMIT: number;
export function validateAnswered(value: unknown): asserts value is Answered;
export function mergeAnswered(value: unknown, item: { parts?: { id: string }[] }, previous?: Answered): Answered;

export type OutlineValue = 'unanswered' | 'answered' | 'correct' | 'wrong' | 'ungradable';
export type OutlineStatus = OutlineValue | Record<string, OutlineValue>;
export const OUTLINE_LABELS: Readonly<Record<OutlineValue, string>>;
export function isOutlineStatus(value: unknown): value is OutlineValue;
export function emptyOutlineStatus(item: { parts?: { id: string }[] }): OutlineStatus;
export function answeredFromStatus(status: OutlineStatus): Answered;
export function reportOutlineStatus(report: unknown, item: { parts?: { id: string }[] }, status: OutlineStatus): OutlineStatus;
