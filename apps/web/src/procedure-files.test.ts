import { describe, expect, it } from 'vitest';
import { exportFileName } from './procedure-files.ts';

describe('exportFileName', () => {
  it('produces safe file names', () => {
    expect(exportFileName('Leave the house')).toBe('leave-the-house.vmn.json');
    expect(exportFileName('../../etc/passwd')).toBe('etc-passwd.vmn.json');
    expect(exportFileName('Küche: Ofen/Herd?')).toBe('kuche-ofen-herd.vmn.json');
    expect(exportFileName('🌼🌼')).toBe('procedure.vmn.json');
    expect(exportFileName('x'.repeat(200))).toBe(`${'x'.repeat(60)}.vmn.json`);
  });
});
