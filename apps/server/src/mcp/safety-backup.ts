import { writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { aiBackupName, listAiBackups, pruneAiBackups } from '@vergissmeinnicht/database';

/** What a safety backup remembers about the change it was made for (no record content, no token). */
export interface AiBackupTrigger {
  readonly userId: string;
  readonly clientId: string;
  readonly workspaceId: string | null;
  readonly tool: string;
}

export interface AiBackupEntry {
  readonly name: string;
  readonly createdAt: Date;
  readonly bytes: number;
  readonly trigger: AiBackupTrigger | null;
}

/** The safety backup before an AI change could not be written: the change is refused, nothing was changed. */
export class AiBackupFailedError extends Error {
  constructor() {
    super('AI safety backup failed');
    this.name = 'AiBackupFailedError';
  }
}

export interface AiBackupService {
  /** The interval and retention in effect (Server admin shows them). */
  readonly settings: { readonly intervalMinutes: number; readonly keep: number };
  /**
   * Called before every MCP tool that changes something (48.1). Writes a verified backup of the whole
   * server first when the newest AI safety backup is older than the interval (or there is none); calls
   * arriving while one is written wait for it. Throws `AiBackupFailedError` when it cannot be written,
   * so the change is never made without a fresh backup.
   */
  beforeChange(trigger: AiBackupTrigger): Promise<{ readonly written: string | null }>;
  /** Newest first. */
  list(): AiBackupEntry[];
}

const TRIGGER_KEYS = ['userId', 'clientId', 'workspaceId', 'tool'] as const;

function readTrigger(path: string): AiBackupTrigger | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (TRIGGER_KEYS.some((key) => key !== 'workspaceId' && typeof value[key] !== 'string')) return null;
    if (value['workspaceId'] !== null && typeof value['workspaceId'] !== 'string') return null;
    return { userId: value['userId'] as string, clientId: value['clientId'] as string, workspaceId: value['workspaceId'] as string | null, tool: value['tool'] as string };
  } catch {
    return null;
  }
}

/**
 * AI safety backups (48.1) in `<database dir>/backups` next to the other server backups. What triggered a
 * backup is kept in a side file `<backup>.json` outside the database, so the list survives a restore of
 * that very backup. `write` makes the backup file itself (the server backup with images and documents;
 * tests pass a lighter one).
 */
export function createAiBackupService(options: {
  readonly dir: string;
  readonly intervalMinutes: number;
  readonly keep: number;
  readonly write: (target: string, now: Date) => Promise<void>;
  readonly now?: () => Date;
  readonly onError?: (error: unknown) => void;
}): AiBackupService {
  const now = options.now ?? (() => new Date());
  let running: Promise<{ readonly written: string | null }> | null = null;

  async function run(trigger: AiBackupTrigger): Promise<{ readonly written: string | null }> {
    const at = now();
    const newest = listAiBackups(options.dir).at(-1);
    if (newest !== undefined && at.getTime() - newest.at.getTime() < options.intervalMinutes * 60_000 && at.getTime() >= newest.at.getTime()) return { written: null };
    const name = aiBackupName(at);
    const target = join(options.dir, name);
    try {
      mkdirSync(options.dir, { recursive: true, mode: 0o700 });
      await options.write(target, at);
      writeFileSync(`${target}.json`, JSON.stringify({ userId: trigger.userId, clientId: trigger.clientId, workspaceId: trigger.workspaceId, tool: trigger.tool }), { mode: 0o600 });
      chmodSync(`${target}.json`, 0o600);
      pruneAiBackups(options.dir, options.keep, at);
    } catch (error) {
      options.onError?.(error);
      throw new AiBackupFailedError();
    }
    return { written: name };
  }

  return {
    settings: { intervalMinutes: options.intervalMinutes, keep: options.keep },
    async beforeChange(trigger) {
      // One backup at a time: a call that arrives meanwhile waits and then counts on that backup.
      while (running !== null) {
        try {
          await running;
        } catch {
          // The failed call refused its own change; this one tries again.
        }
      }
      const current = run(trigger);
      running = current;
      try {
        return await current;
      } finally {
        running = null;
      }
    },
    list() {
      return listAiBackups(options.dir)
        .reverse()
        .map((entry) => ({ name: entry.name, createdAt: entry.at, bytes: entry.bytes, trigger: readTrigger(`${entry.path}.json`) }));
    },
  };
}
