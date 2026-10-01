import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_QUOTA, DomainValidationError, IMAGE_QUOTA_CHOICES, normalizeProcedureStructure, parseImageQuota, parseStepImage } from './index.ts';

const code = (action: () => unknown) => {
  try {
    action();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    return (error as DomainValidationError).code;
  }
};
const ID = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
const STEP = { title: 'Close the main water valve', description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };

describe('instruction images (14.3)', () => {
  it('requires a short caption with an image and none without', () => {
    expect(parseStepImage(null)).toBeNull();
    expect(parseStepImage(undefined)).toBeNull();
    expect(parseStepImage({ id: ID, caption: '  Blue lever left of the meter ' })).toEqual({ id: ID, caption: 'Blue lever left of the meter' });
    expect(code(() => parseStepImage({ id: ID, caption: ' ' }))).toBe('image_caption_empty');
    expect(code(() => parseStepImage({ id: ID, caption: 'x'.repeat(201) }))).toBe('image_caption_too_long');
    expect(code(() => parseStepImage({ id: ID, caption: 'bad‮text' }))).toBe('image_caption_invalid_characters');
    expect(code(() => parseStepImage({ id: 'IMG-1', caption: 'x' }))).toBe('invalid_image_id');
  });

  it('carries the image through the structure, one per Step', () => {
    const draft = normalizeProcedureStructure([{ title: 'Kitchen', description: '', steps: [{ ...STEP, image: { id: ID, caption: 'Valve' } }, STEP] }]);
    expect(draft.sections[0]?.steps.map((step) => step.image)).toEqual([{ id: ID, caption: 'Valve' }, null]);
  });

  it('offers exactly the approved quotas, 100 MB by default, in decimal bytes', () => {
    expect(IMAGE_QUOTA_CHOICES).toEqual([100_000_000, 250_000_000, 500_000_000, 1_000_000_000]);
    expect(DEFAULT_IMAGE_QUOTA).toBe(100_000_000);
    expect(parseImageQuota(250_000_000)).toBe(250_000_000);
    for (const bad of [0, 104_857_600, 2_000_000_000, -1]) expect(code(() => parseImageQuota(bad))).toBe('invalid_image_quota');
  });
});
