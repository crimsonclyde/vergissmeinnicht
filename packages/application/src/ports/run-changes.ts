import type { RunChange } from '@vergissmeinnicht/domain';

/**
 * Fan-out of committed Run changes (SSE, Step 6.1). Called only after the transaction committed;
 * implementations must not throw — a failed notification never turns a committed write into an error.
 */
export interface RunChangeNotifier {
  runChanged(change: RunChange): void;
}
