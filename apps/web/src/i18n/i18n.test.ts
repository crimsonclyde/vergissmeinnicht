import { describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { formatDateTime, hasMessage, t } from './index.ts';

describe('i18n', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(t('step.undo', { title: 'Stove off' })).toBe('Undo: Stove off');
    expect(t('step.undo')).toBe('Undo: {title}');
  });

  it('chooses plural forms by count', () => {
    expect(t('run.progress', { resolved: 0, count: 1 })).toBe('0 of 1 Step resolved');
    expect(t('run.progress', { resolved: 1, count: 2 })).toBe('1 of 2 Steps resolved');
    expect(t('history.stepsAdded', { count: 1 })).toBe('1 Step added');
    expect(t('history.stepsAdded', { count: 3 })).toBe('3 Steps added');
  });

  it('never interprets values as templates or markup', () => {
    expect(t('step.undo', { title: '{title} <b>x</b>' })).toBe('Undo: {title} <b>x</b>');
  });

  it('knows error codes only when a message exists', () => {
    expect(hasMessage('error.step_conflict')).toBe(true);
    expect(hasMessage('error.nope')).toBe(false);
    expect(hasMessage('__proto__')).toBe(false);
    expect(hasMessage('toString')).toBe(false);
  });

  it('formats dates through one function', () => {
    expect(formatDateTime('2026-09-27T15:40:00.000Z')).toMatch(/2026/);
  });

  it('has only well-formed messages', () => {
    for (const [key, message] of Object.entries(en)) {
      const templates = typeof message === 'string' ? [message] : Object.values(message);
      for (const template of templates) {
        expect(template.trim(), key).not.toBe('');
        expect(template, key).not.toMatch(/<[a-z]/i);
        expect(template.split('{').length, key).toBe(template.split('}').length);
      }
      if (typeof message !== 'string') expect(Object.values(message).join(), key).toContain('{count}');
    }
  });
});
