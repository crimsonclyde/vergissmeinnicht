/**
 * Decoration helpers shared by the redesigned areas (steps.md 41): a stable tint per word, so a category
 * or a person keeps its colour, and a monogram for a name. Presentation only; nothing is stored.
 */
export const toneOf = (word: string): string => String([...word].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 5);

/** Up to two letters of a name: "Dr. Anna Weber" → "AW", "Stadtwerke" → "S". */
export function monogram(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word.length > 1 || /\p{L}/u.test(word));
  const letters = words.filter((word, index) => index === 0 || index === words.length - 1 || words.length <= 2);
  const meaningful = letters.length > 2 ? [letters[0], letters[letters.length - 1]] : letters;
  const text = meaningful.map((word) => [...(word ?? '')][0] ?? '').join('').toUpperCase();
  return text === '' ? '·' : text.slice(0, 2);
}
