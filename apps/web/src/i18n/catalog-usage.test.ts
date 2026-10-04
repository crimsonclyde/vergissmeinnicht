import { describe, expect, it } from 'vitest';
import { en } from './en.ts';

// Every message must be used somewhere, so the catalog does not collect dead text (steps.md 8.4/8.6).
const sources = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const code = Object.entries(sources)
  // Files next to this test appear as './…', the rest as '../…'; the catalog itself must not count.
  .filter(([path]) => !path.startsWith('./') && !path.includes('/i18n/') && !path.endsWith('.test.ts'))
  .map(([, text]) => text)
  .join('\n');

/** Keys built at runtime, e.g. t(`state.${state}`); `error.*` keys are chosen by server error codes. */
const DYNAMIC_PREFIXES = [
  'state.',
  'stateCount.',
  'runState.',
  'role.',
  'roleHelp.',
  'live.',
  'appearance.',
  'icon.',
  'iconGroup.',
  'policy.',
  'knot.target.',
  'knot.status.',
  'knot.lifetime.',
  'admin.status.',
  'securityEvent.',
  'criticalConfirm.',
  'history.',
  'error.',
  'admin.testFailed.',
  // Schedules (14.1, 14.2): units, repetitions, reminder offsets and Home filters by name.
  'home.filter.',
  'schedule.unit.',
  'schedule.unitName.',
  'schedule.every.',
  'schedule.interval.',
  'schedule.reminder.',
  // Calendar (14.4): view, status and type names.
  'calendar.view.',
  'calendar.status.',
  'occurrenceStatus.',
  'calendar.type.',
  // Instruction photos (14.3): refusal reasons by the server's stable code.
  'image.rejected.',
  // Settings sections by their address, builder problems by code, reason policies in short form (15.1, 15.2).
  'account.section.',
  'admin.section.',
  'builder.problem.',
  'policy.short.',
  // Documents (16.2): built-in type names by key, refusal reasons by the server's stable code.
  'documents.type.',
  'documents.rejected.',
  // Finding Documents (16.3): the orders and the two views by name.
  'documents.find.sort.',
  'documents.find.view.',
  // Contacts (16.6): why an import file was refused, by the server's stable code.
  'contacts.importRefused.',
  // Equipment form fields and link choices are selected from closed domain/UI lists.
  'equipment.field.',
  'equipment.link.',
];

describe('message catalog', () => {
  it('has no unused messages', () => {
    const unused = Object.keys(en).filter(
      (key) => !code.includes(`'${key}'`) && !DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
    expect(unused).toEqual([]);
  });
});
