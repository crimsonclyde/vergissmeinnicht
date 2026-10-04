import { describe, expect, it } from 'vitest';
import { normalizeEquipmentContent, parseEquipmentCursor, parseEquipmentLinkTarget, parseEquipmentQuery, equipmentSearchText } from './equipment.ts';
describe('Equipment validation', () => {
    it('needs only a name; trims text, keeps serials literal and accepts calendar dates', () => {
        expect(normalizeEquipmentContent({ name: ' Boiler ' })).toMatchObject({ name: 'Boiler', serialNumber: '', purchaseDate: null, warrantyExpiry: null, notes: '' });
        expect(normalizeEquipmentContent({ name: 'Boiler', serialNumber: '00-12', purchaseDate: '2024-02-29', notes: 'a\r\nb' })).toMatchObject({ serialNumber: '00-12', notes: 'a\nb' });
    });
    it('rejects empty names, excessive text, control/bidi chars and invalid dates', () => {
        for (const input of [{ name: '' }, { name: 'x'.repeat(201) }, { name: 'Boiler', serialNumber: '\u202E' }, { name: 'Boiler', notes: '\u0001' }, { name: 'Boiler', warrantyExpiry: '2025-02-29' }, { name: 'Boiler', category: 'x'.repeat(61) }, { name: 'Boiler', notes: 'x'.repeat(4001) }])
            expect(() => normalizeEquipmentContent(input)).toThrow();
    });
    it('folds category, location and manufacturer; serials never enter derived search text', () => {
        const content = normalizeEquipmentContent({ name: 'Kühlschrank', category: 'Küche', manufacturer: 'Müller', serialNumber: 'SECRET-123' });
        expect(equipmentSearchText(content)).toContain('kuhlschrank');
        expect(equipmentSearchText(content)).not.toContain('secret');
        expect(parseEquipmentQuery({ manufacturer: 'Müller' }).manufacturer).toBe('muller');
    });
    it('bounds cursor and link types', () => {
        expect(parseEquipmentCursor(['a', 'foreign'])).toBeUndefined();
        expect(() => parseEquipmentLinkTarget({ type: 'mail', id: 'foreign' })).toThrow();
    });
});
