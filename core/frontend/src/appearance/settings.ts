export interface AppearanceValue {
  theme: string; dim: number; clear: Record<string, number>; custom: boolean;
}
export interface AppearanceState {
  value: AppearanceValue; busy: boolean; error: string; canChoose: boolean;
}
export interface AppearanceConfig {
  themes: readonly { id: string; label: string }[];
  initial: AppearanceValue;
  images: { get(): Promise<unknown>; put(blob: Blob): Promise<unknown>; remove(): Promise<unknown> } | null;
  prepare(file: File): Promise<Blob>;
  save(value: AppearanceValue): void;
  apply(value: AppearanceValue, url: string | null): void;
  urls: { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void };
  isBlob(value: unknown): value is Blob;
  close(): void;
}

// Small preferences only; image blobs and object URLs stay outside Vue state.
export function createAppearanceSettings(config: AppearanceConfig, render: (state: AppearanceState) => void) {
  let value = config.initial, busy = false, error = '', imageUrl: string | null = null;
  let destroyed = false, imageRevision = 0;
  const publish = () => { if (!destroyed) render({ value, busy, error, canChoose: !!config.images }); };
  const apply = () => config.apply(value, value.custom ? imageUrl : null);
  const save = () => config.save(value);
  const setImage = (blob: Blob | null) => {
    if (imageUrl) config.urls.revokeObjectURL(imageUrl);
    imageUrl = blob ? config.urls.createObjectURL(blob) : null;
  };
  const valid = (next: number, max: number) => Number.isInteger(next) && next >= 0 && next <= max && next % 5 === 0;
  const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message :
    (cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' ? cause.message : fallback);
  const actions = {
    select(theme: string) {
      if (destroyed || !config.themes.some(item => item.id === theme)) return;
      value = { ...value, theme }; error = ''; save(); apply(); publish();
    },
    dim(next: number) {
      if (destroyed || !valid(next, 80)) return;
      value = { ...value, dim: next }; save(); apply(); publish();
    },
    clear(next: number) {
      if (destroyed || !valid(next, 70) || !Object.hasOwn(value.clear, value.theme)) return;
      value = { ...value, clear: { ...value.clear, [value.theme]: next } }; save(); apply(); publish();
    },
    clearError() { if (!destroyed) { error = ''; publish(); } },
    close() { if (!destroyed) config.close(); },
    async choose(file: File | undefined) {
      if (destroyed || busy || !file || !config.images) return;
      const revision = ++imageRevision;
      busy = true; error = ''; publish();
      try {
        const blob = await config.prepare(file);
        if (destroyed || revision !== imageRevision) return;
        await config.images.put(blob);
        if (destroyed || revision !== imageRevision) return;
        setImage(blob); value = { ...value, theme: 'image', custom: true }; save(); apply();
      } catch (cause) {
        if (!destroyed && revision === imageRevision) error = message(cause, '图片未能保存，请重试');
      } finally {
        if (!destroyed && revision === imageRevision) { busy = false; publish(); }
      }
    },
    async reset() {
      if (destroyed || busy) return;
      const revision = ++imageRevision;
      busy = true; publish();
      try {
        await config.images?.remove();
        if (destroyed || revision !== imageRevision) return;
        setImage(null); value = { ...value, custom: false }; error = ''; save(); apply();
      } catch (cause) {
        if (!destroyed && revision === imageRevision) error = message(cause, '未能恢复默认图片，请重试');
      } finally {
        if (!destroyed && revision === imageRevision) { busy = false; publish(); }
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; ++imageRevision; setImage(null); apply();
    },
  };
  const initialize = () => {
    apply(); publish();
    const revision = imageRevision;
    return (async () => {
      if (!value.custom || !config.images) return;
      try {
        const blob = await config.images.get();
        if (destroyed || revision !== imageRevision) return;
        if (config.isBlob(blob)) { setImage(blob); apply(); }
        else { value = { ...value, custom: false }; save(); publish(); }
      } catch { /* Keep the built-in picture if local image storage is unavailable. */ }
    })();
  };
  return { ...actions, get value() { return value; }, initialize };
}
export type AppearanceActions = ReturnType<typeof createAppearanceSettings>;
