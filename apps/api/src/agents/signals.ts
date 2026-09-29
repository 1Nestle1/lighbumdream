import { EventEmitter } from "node:events";

// Wakes whoever is waiting for agent work, so a runner's long poll or the cloud worker picks
// up a new task at once instead of on its next poll. In-process only: with several API
// servers the pollers still find the work, just a few seconds later.

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

/** Queue name of the cloud worker; local runners wait on their own id. */
export const CLOUD_QUEUE = "cloud";

export const signalWork = (queue: string) => {
  emitter.emit(queue);
};

/** Resolves when work is signalled on the queue, after `ms`, or when `signal` aborts. */
export function waitForWork(queue: string, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      emitter.off(queue, done);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    emitter.once(queue, done);
    signal?.addEventListener("abort", done, { once: true });
  });
}
