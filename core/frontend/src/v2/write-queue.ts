/** One bank-wide queue. Each operation freezes its payload only when first
 * dispatched; a transport retry reuses those exact bytes and request id. */
export function createWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(action: () => Promise<T>): Promise<T> => {
    const next = tail.then(action);
    tail = next.catch(() => {});
    return next;
  };
  return {
    enqueue,
    drain: () => tail.then(() => {}),
    prepare<T>(
      capture: () => { route: string; body: string },
      send: (route: string, body: string) => Promise<T>,
      saved: (value: T) => void,
    ) {
      let request: { route: string; body: string } | undefined;
      return () =>
        enqueue(async () => {
          request ??= capture();
          const value = await send(request.route, request.body);
          saved(value);
        });
    },
  };
}
