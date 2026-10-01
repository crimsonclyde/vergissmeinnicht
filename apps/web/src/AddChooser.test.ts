import { describe, expect, it } from 'vitest';
import { addChoices } from './AddChooser.tsx';

const W = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';

describe('Add chooser', () => {
  it('offers only what the person may create', () => {
    const keys = (can: { procedure: boolean; reminder: boolean; list: boolean }) => addChoices(can).map((choice) => choice.key);
    // EDITOR and ADMIN.
    expect(keys({ procedure: true, reminder: true, list: true })).toEqual(['procedure', 'reminder', 'list']);
    // USER: schedules and shops, but does not author Procedures.
    expect(keys({ procedure: false, reminder: true, list: true })).toEqual(['reminder', 'list']);
    // GUEST: nothing to add, so no Add button at all.
    expect(keys({ procedure: false, reminder: false, list: false })).toEqual([]);
  });

  it('opens each creation flow directly', () => {
    const hrefs = addChoices({ procedure: true, reminder: true, list: true }).map((choice) => choice.href(W));
    expect(hrefs).toEqual([`/w/${W}/procedures/new`, `/w/${W}/reminders/new`, `/w/${W}/lists/new`]);
  });
});
