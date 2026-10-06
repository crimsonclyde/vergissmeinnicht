import { describe, expect, it } from 'vitest';
import { MAX_TEXT_CHARS, PAGE_SEPARATOR, cleanRecognizedText, findSnippet, hasUsableEmbeddedText, joinPageTexts, recognizedSearchText } from './document-text.ts';

describe('recognised text (16.9)', () => {
  it('is cleaned like any untrusted text: no controls, bidi overrides or invisible characters; spaces collapsed', () => {
    expect(cleanRecognizedText('Tot\u0000ale  da\tpagare‮: 87,40​\r\n\n\n\nScadenza')).toBe('Tot ale da pagare : 87,40\n\nScadenza');
    expect(cleanRecognizedText('a'.repeat(10), 4)).toBe('aaaa');
    // A form feed is the page separator and can never come from a page itself.
    expect(cleanRecognizedText(`one${PAGE_SEPARATOR}two`)).toBe('one two');
  });

  it('treats a PDF page with almost no embedded text as a scan', () => {
    expect(hasUsableEmbeddedText('  \n 1 \n')).toBe(false);
    expect(hasUsableEmbeddedText('Versicherungsschein Nr. 7731')).toBe(true);
  });

  it('keeps at most MAX_TEXT_CHARS of a file', () => {
    expect([...joinPageTexts(['x'.repeat(MAX_TEXT_CHARS), 'more'])]).toHaveLength(MAX_TEXT_CHARS);
  });

  it('is searched folded, like titles: case, accents and ß do not matter', () => {
    expect(recognizedSearchText('Fälligkeit GROSSE Straße perché')).toBe('falligkeit grosse strasse perche');
  });

  it('finds a snippet on the right page, mapping folded positions back to the original text', () => {
    const text = ['Erste Seite', 'Jahresbeitrag einschließlich Versicherungsteuer: 184,20 EUR'].join(PAGE_SEPARATOR);
    expect(findSnippet(text, ['einschliesslich'])).toEqual({ text: 'Jahresbeitrag einschließlich Versicherungsteuer: 184,20 EUR', page: 2 });
    expect(findSnippet(text, ['nirgends'])).toBeUndefined();
    expect(findSnippet(text, [])).toBeUndefined();
  });

  it('cuts long context with an ellipsis and never crosses into another page', () => {
    const page = `${'a '.repeat(80)}Bolletta${' b'.repeat(80)}`;
    const snippet = findSnippet(`${page}${PAGE_SEPARATOR}Bolletta elsewhere`, ['bolletta']);
    expect(snippet?.page).toBe(1);
    expect(snippet?.text.startsWith('…')).toBe(true);
    expect(snippet?.text.endsWith('…')).toBe(true);
    expect(snippet?.text).toContain('Bolletta');
    expect(snippet?.text).not.toContain('elsewhere');
  });
});
