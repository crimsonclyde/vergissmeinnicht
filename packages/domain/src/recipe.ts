import { DomainValidationError } from './errors.ts';
import { BIDI_CONTROLS, CONTROL_CHARS } from './text.ts';
import { normalizeListItemQuantity } from './list.ts';
import { markdownAttachments } from './journal/markdown.ts';

export interface RecipeIngredient {
  readonly name: string;
  readonly amount: string;
  readonly unit: string;
  readonly note: string;
}
export interface RecipeContent {
  readonly version: 1;
  readonly title: string;
  readonly servings: number;
  readonly ingredients: readonly RecipeIngredient[];
  readonly instructions: string;
  readonly tags: readonly string[];
  readonly source: string;
  readonly prepMinutes: number | null;
  readonly cookMinutes: number | null;
  readonly coverImage?: string | undefined;
  readonly private?: boolean | undefined;
}
export interface Recipe extends RecipeContent {
  readonly id: string;
  readonly private: boolean;
  readonly inCurrentWorkspace: boolean;
  readonly homeWorkspaceName: string;
  readonly revision: number;
  readonly archived: boolean;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}

function invalid(): never {
  throw new DomainValidationError('recipe', 'invalid_recipe', 'Invalid recipe');
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) return invalid();
  return row;
}
function text(value: unknown, max: number, multiline = false): string {
  if (typeof value !== 'string' || [...value].length > max || BIDI_CONTROLS.test(value) || CONTROL_CHARS.test(multiline ? value.replace(/[\r\n\t]/g, '') : value) || (!multiline && /[\r\n]/.test(value))) return invalid();
  return multiline ? value : value.trim().normalize('NFC');
}

type Fraction = readonly [bigint, bigint];
function fraction(value: string): Fraction {
  if (/^\d{1,5}(?:[.,]\d{1,3})?$/.test(value)) {
    const [whole = '', decimals = ''] = value.replace(',', '.').split('.');
    const numerator = BigInt(whole + decimals);
    if (numerator === 0n) return invalid();
    return [numerator, 10n ** BigInt(decimals.length)];
  }
  const match = /^(?:(\d{1,5}) )?(\d{1,5})\/([1-9]\d{0,4})$/.exec(value);
  if (!match) return invalid();
  const denominator = BigInt(match[3] ?? '1');
  const numerator = BigInt(match[1] ?? '0') * denominator + BigInt(match[2] ?? '0');
  if (numerator === 0n) return invalid();
  return [numerator, denominator];
}
function gcd(a: bigint, b: bigint): bigint { while (b) [a, b] = [b, a % b]; return a; }

/** Exact serving projection. Values outside the grocery decimal contract require explicit review. */
export function scaleRecipeIngredients(recipe: Pick<RecipeContent, 'servings' | 'ingredients'>, servings: number) {
  if (!Number.isInteger(recipe.servings) || recipe.servings < 1 || recipe.servings > 1000 || !Number.isInteger(servings) || servings < 1 || servings > 1000) return invalid();
  return recipe.ingredients.map(ingredient => {
    if (!ingredient.amount) return { ...ingredient, quantity: null, exactAmount: '', requiresReview: false };
    const [amount, divisor] = fraction(ingredient.amount);
    let numerator = amount * BigInt(servings);
    let denominator = divisor * BigInt(recipe.servings);
    const common = gcd(numerator, denominator); numerator /= common; denominator /= common;
    let quantity: string | null = null;
    if ((numerator * 1000n) % denominator === 0n) {
      const thousandths = numerator * 1000n / denominator;
      const decimal = `${thousandths / 1000n}.${String(thousandths % 1000n).padStart(3, '0')}`;
      try { quantity = normalizeListItemQuantity(decimal); } catch { /* A bounded explicit review is required. */ }
    }
    const exactAmount = denominator === 1n ? String(numerator) : `${numerator}/${denominator}`;
    return { ...ingredient, quantity, exactAmount, requiresReview: quantity === null };
  });
}

export function parseRecipeContent(value: unknown): RecipeContent {
  const keys = ['version', 'title', 'servings', 'ingredients', 'instructions', 'tags', 'source', 'prepMinutes', 'cookMinutes'];
  if (value && typeof value === 'object' && Object.hasOwn(value, 'coverImage')) keys.push('coverImage');
  if (value && typeof value === 'object' && Object.hasOwn(value, 'private')) keys.push('private');
  const row = object(value, keys);
  const isPrivate = row['private'];
  if (keys.includes('private') && typeof isPrivate !== 'boolean') return invalid();
  const title = text(row['title'], 160);
  if (!title || row['version'] !== 1 || !Number.isInteger(row['servings']) || Number(row['servings']) < 1 || Number(row['servings']) > 1000) return invalid();
  if (!Array.isArray(row['ingredients']) || row['ingredients'].length < 1 || row['ingredients'].length > 100) return invalid();
  const ingredients = row['ingredients'].map(value => {
    const item = object(value, ['name', 'amount', 'unit', 'note']);
    const name = text(item['name'], 120); const amount = text(item['amount'], 32);
    if (!name) return invalid();
    if (amount) fraction(amount);
    return { name, amount, unit: text(item['unit'], 16), note: text(item['note'], 160) };
  });
  if (!Array.isArray(row['tags']) || row['tags'].length > 12) return invalid();
  const tags = [...new Set(row['tags'].map(tag => text(tag, 40)).filter(Boolean))];
  const source = text(row['source'], 2048);
  if (source && !/^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(source)) return invalid();
  const minutes = (value: unknown): number | null => value === null ? null : Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10080 ? Number(value) : invalid();
  const instructions = text(row['instructions'], 50000, true);
  const cover = row['coverImage'];
  if (cover !== undefined && (typeof cover !== 'string' || !recipeImages({ instructions }).some(image => image.url === cover))) return invalid();
  return { version: 1, title, servings: Number(row['servings']), ingredients, instructions, tags, source, prepMinutes: minutes(row['prepMinutes']), cookMinutes: minutes(row['cookMinutes']), ...(cover === undefined ? {} : { coverImage: cover }), ...(typeof isPrivate === 'boolean' ? { private: isPrivate } : {}) };
}

export function recipeImages(recipe: Pick<RecipeContent, 'instructions'>) {
  return [...new Map(markdownAttachments(recipe.instructions, true).map(image => [image.url, image])).values()];
}

export function recipeCover(recipe: Pick<RecipeContent, 'instructions' | 'coverImage'>) {
  const images = recipeImages(recipe);
  return images.find(image => image.url === recipe.coverImage) ?? images[0];
}

export interface RecipeTransfer {
  readonly operationId: string;
  readonly recipeRevision: number;
  readonly listId: string;
  readonly listRevision: number;
  readonly servings: number;
  readonly items: readonly { readonly ingredient: number; readonly title: string; readonly quantity: string | null; readonly unit: string | null }[];
}
