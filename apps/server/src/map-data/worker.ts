import { parentPort, workerData } from 'node:worker_threads';
import { areaSchema } from './area.ts';
import { downloadMap } from './download.ts';
const { directory, area } = workerData as { directory: string; area: unknown };
try {
  const result = await downloadMap(directory, areaSchema.parse(area), percent => parentPort?.postMessage({ percent }), AbortSignal.timeout(20 * 60_000));
  parentPort?.postMessage({ result });
} catch {
  // Remote/parser diagnostics can contain provider response content; return a stable code only.
  parentPort?.postMessage({ failed: true });
}
