export function attachSaveLifecycle(
  view: Window,
  saver: { readonly dirty: boolean; flush(): Promise<void> },
) {
  const unload = (event: BeforeUnloadEvent) => {
    if (saver.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  const visibility = () => {
    if (view.document.visibilityState === 'hidden' && saver.dirty) {
      void saver.flush().catch(() => {});
    }
  };
  view.addEventListener('beforeunload', unload);
  view.document.addEventListener('visibilitychange', visibility);
  return () => {
    view.removeEventListener('beforeunload', unload);
    view.document.removeEventListener('visibilitychange', visibility);
  };
}
