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
    prepare<Request extends { route: string; body: string }, T>(
      capture: () => Request,
      send: (request: Request) => Promise<T>,
      saved: (value: T) => void,
    ) {
      let request: Request | undefined;
      return () =>
        enqueue(async () => {
          request ??= capture();
          const value = await send(request);
          saved(value);
        });
    },
  };
}
