// AbortSignal.any is unavailable in iOS 16.4. Keep the deadline active until
// the response body has been read, and release the timer/listener on every exit.
export async function withRequestTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
  milliseconds = 15000,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason);
  if (parent?.aborted) cancel();
  else parent?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out", "TimeoutError")),
    milliseconds,
  );
  try {
    controller.signal.throwIfAborted();
    return await request(controller.signal);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
  }
}
