import type { Sidebar } from '../types/layout';
export const SIDEBARS = {
  library: { initial: 256, min: 200, max: 420 },
  outline: { initial: 244, min: 200, max: 380 },
} as const;
const STORAGE_KEY = 'quizforge.v2.sidebar-widths';
export function sidebarWidth(side: Sidebar, width: number) {
  return Math.round(Math.max(SIDEBARS[side].min, Math.min(SIDEBARS[side].max, width)));
}
export function readWidths() {
  const widths: Record<Sidebar, number> = {
    library: SIDEBARS.library.initial,
    outline: SIDEBARS.outline.initial,
  };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') {
      return widths;
    }
    for (const side of ['library', 'outline'] as const) {
      const value: unknown = Reflect.get(saved, side);
      if (typeof value === 'number' && Number.isFinite(value)) {
        widths[side] = sidebarWidth(side, value);
      }
    }
  } catch {
    // Browser preferences may be unavailable; sizing still works in this window.
  }
  return widths;
}
export function writeWidths(widths: Record<Sidebar, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Width is a device preference, never part of the practice record.
  }
}
