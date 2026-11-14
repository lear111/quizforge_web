import { OUTLINE_LABELS } from '../../../../shared/v2/answered.js';
import type { OutlineGroup } from '../../../../shared/v2/bank.js';
import type { StateSummary as State } from '../../../../shared/v2/state.js';
import type { OutlineModel } from '../../outline/model';
export type { OutlineItem as Item } from '../../../../shared/v2/bank.js';
export type { StateSummary as State } from '../../../../shared/v2/state.js';
export function buildV2Outline(
  groups: OutlineGroup[],
  states: State[],
  currentId?: string,
): OutlineModel {
  const byId = new Map(states.map((state) => [state.questionId, state.status]));
  return {
    summaryAvailable: false,
    summaryShown: false,
    groups: groups.map((group, index) => ({
      key: String(index),
      name: group.title,
      buttons: group.items.flatMap((item) => {
        const outline = byId.get(item.id);
        return (item.parts ?? [{ id: null, label: item.label ?? item.id }]).map((part) => {
          const status =
            (part.id === null
              ? typeof outline === 'string' && outline
              : outline &&
                typeof outline === 'object' &&
                Object.hasOwn(outline, part.id) &&
                outline[part.id]) || 'unanswered';
          const label = OUTLINE_LABELS[status];
          return {
            key: `${item.id}:${part.id}`,
            questionId: item.id,
            itemId: part.id,
            label: part.label,
            status,
            active: currentId === item.id,
            title: `第 ${part.label} 题 · ${label}`,
            ariaLabel: `第 ${part.label} 题：${label}`,
          };
        });
      }),
    })),
  };
}
