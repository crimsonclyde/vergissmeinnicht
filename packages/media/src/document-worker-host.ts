import { Worker } from 'node:worker_threads';
import type { WorkerFailure, WorkerJob, WorkerResult } from './document-worker.ts';

/** The file made the parser fail or exceed its limits; `too_complex` = time or memory ran out. */
export class WorkerJobError extends Error {
  readonly code: WorkerFailure | 'too_complex';

  constructor(code: WorkerFailure | 'too_complex') {
    super(`document worker: ${code}`);
    this.name = 'WorkerJobError';
    this.code = code;
  }
}

export interface DocumentWorkerOptions {
  /** A job is ended after this long (default 30 s). */
  readonly timeoutMs?: number;
  /**
   * Watchdog: a job is ended when the whole process has grown by more than this since the job began
   * (default 1.5 GB), checked five times a second. It is **not a hard limit** — memory taken between
   * two checks, or while the main thread is busy, is not seen in time, and other work in the process
   * counts too. The bound that always holds is the parser's own: MuPDF's WebAssembly memory cannot
   * exceed 2 GiB. A real ceiling for the server is a memory limit on the container.
   */
  readonly maxMemoryGrowthBytes?: number;
  /** An idle worker is stopped after this long, which returns all its memory (default 30 s). */
  readonly idleMs?: number;
}

export interface DocumentWorker {
  run<T extends WorkerResult['op']>(job: WorkerJob & { readonly op: T }): Promise<WorkerResult & { readonly op: T }>;
  close(): Promise<void>;
}

/**
 * One worker thread that parses PDFs, **one job at a time**. A job that takes too long is ended by
 * terminating the thread — the only reliable way to stop a parser that is stuck inside WebAssembly —
 * and the next job gets a fresh one; a memory watchdog does the same when the process grows too much
 * (best effort, see `maxMemoryGrowthBytes`). The thread is started on demand and stopped when idle,
 * which returns all of its memory.
 */
export function createDocumentWorker(options: DocumentWorkerOptions = {}): DocumentWorker {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxGrowth = options.maxMemoryGrowthBytes ?? 1_500_000_000;
  const idleMs = options.idleMs ?? 30_000;
  let worker: Worker | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let nextId = 1;
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;

  function stop(): void {
    clearTimeout(idleTimer);
    const current = worker;
    worker = undefined;
    void current?.terminate();
  }

  function execute(job: WorkerJob): Promise<WorkerResult> {
    if (closed) return Promise.reject(new WorkerJobError('failed'));
    clearTimeout(idleTimer);
    // The JavaScript heap is small by design; the parser's own (WebAssembly) memory is bounded by the module.
    if (worker === undefined) {
      worker = new Worker(new URL('./document-worker.ts', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 256 } });
      // Never the reason the process stays alive.
      worker.unref();
    }
    const current = worker;
    const id = nextId++;
    return new Promise<WorkerResult>((resolve, reject) => {
      const baseline = process.memoryUsage().rss;
      const end = (settle: () => void, kill: boolean) => {
        clearTimeout(timer);
        clearInterval(watch);
        current.off('message', onMessage);
        current.off('error', onFailure);
        current.off('exit', onFailure);
        if (kill) stop();
        else {
          idleTimer = setTimeout(stop, idleMs);
          idleTimer.unref();
        }
        settle();
      };
      const onMessage = (message: { id: number; ok: boolean; result?: WorkerResult; code?: WorkerFailure }) => {
        if (message.id !== id) return;
        if (message.ok && message.result !== undefined) end(() => resolve(message.result as WorkerResult), false);
        else end(() => reject(new WorkerJobError(message.code ?? 'failed')), false);
      };
      const onFailure = () => end(() => reject(new WorkerJobError('too_complex')), true);
      const timer = setTimeout(onFailure, timeoutMs);
      const watch = setInterval(() => {
        if (process.memoryUsage().rss - baseline > maxGrowth) onFailure();
      }, 200);
      current.on('message', onMessage);
      current.once('error', onFailure);
      current.once('exit', onFailure);
      current.postMessage({ id, job });
    });
  }

  return {
    run(job) {
      const result = tail.then(
        () => execute(job),
        () => execute(job),
      );
      tail = result.catch(() => undefined);
      return result as Promise<never>;
    },
    async close() {
      closed = true;
      await tail;
      stop();
    },
  };
}
