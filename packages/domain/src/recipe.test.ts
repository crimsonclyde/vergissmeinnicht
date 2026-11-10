import { describe, expect, it } from 'vitest';
import { parseRecipeContent, recipeCover, scaleRecipeIngredients } from './recipe.ts';
const recipe = { version: 1, title: 'Pancakes', servings: 2, ingredients: [{ name: 'Flour', amount: '125', unit: 'g', note: '' }, { name: 'Eggs', amount: '1', unit: '', note: '' }, { name: 'Salt', amount: '', unit: '', note: 'to taste' }], instructions: '# Cook\n\nKeep source intact.', tags: ['Breakfast'], source: '', prepMinutes: 5, cookMinutes: 10 };
describe('recipe content and exact serving projection', () => {
  it('scales authoritative amounts without changing the base recipe or to-taste wording', () => {
    const content = parseRecipeContent(recipe);
    expect(scaleRecipeIngredients(content, 4).map(item => item.quantity)).toEqual(['250', '2', null]);
    expect(content.ingredients[0]?.amount).toBe('125');
    expect(scaleRecipeIngredients(content, 3)[1]?.quantity).toBe('1.5');
    expect(scaleRecipeIngredients(content, 4)[2]?.note).toBe('to taste');
  });
  it.each(['etwas', 'eine Prise', 'nach Geschmack', 'a bit', 'a pinch', 'to taste', 'un pizzico', 'Q. B.', 'un po’'])(
    'preserves the descriptive amount %s through a serving change',
    amount => {
      const ingredient = { name: 'Salt', amount, unit: '', note: 'fine sea salt' };
      const content = parseRecipeContent({ ...recipe, ingredients: [ingredient] });
      expect(content.ingredients).toEqual([ingredient]);
      expect(scaleRecipeIngredients(content, 4)[0]).toEqual({
        ...ingredient, quantity: null, descriptiveAmount: amount, exactAmount: '', requiresReview: false,
      });
    },
  );
  it('handles fractions exactly and refuses silent rounding or overflow', () => {
    const ingredient = {name:'Flour',amount:'1 1/2',unit:'cups',note:''};
    const ingredients = [ingredient];
    expect(scaleRecipeIngredients({ servings: 2, ingredients }, 4)[0]?.quantity).toBe('3');
    expect(scaleRecipeIngredients({ servings: 3, ingredients: [{ ...ingredient, amount: '1' }] }, 4)[0]).toMatchObject({ quantity: null, exactAmount: '4/3', requiresReview: true });
    expect(scaleRecipeIngredients({ servings: 1, ingredients: [{ ...ingredient, amount: '99999' }] }, 1000)[0]?.requiresReview).toBe(true);
  });
  it('uses the first local image for older recipes and validates a designated cover', () => {
    const first = 'attachments/c82d9cda-cbd2-4a9e-a6dd-a872682a3822.jpg';
    const second = 'attachments/75748870-210a-4ed2-8b8c-6a479d332130.png';
    const linked = 'attachments/099cf9ce-aa53-4416-967f-284894713a65.png';
    const instructions = `[Original](${linked})

![First](${first})

![Second][photo]

[photo]: ${second}`;
    expect(recipeCover(parseRecipeContent({ ...recipe, instructions }))?.url).toBe(first);
    expect(recipeCover(parseRecipeContent({ ...recipe, instructions, coverImage: second }))?.url).toBe(second);
    for (const coverImage of [linked, 'https://example.com/cover.png', 'javascript:alert(1)']) {
      expect(() => parseRecipeContent({ ...recipe, instructions, coverImage })).toThrow();
    }
  });
  it('bounds hostile content, quantities and source links, preserving Markdown literally', () => {
    expect(parseRecipeContent(recipe).instructions).toBe(recipe.instructions);
    for (const patch of [{ servings: 0 }, { ingredients: [] }, { source: 'javascript:alert(1)' }, { title: '\u202eevil' }, { unexpected: true }]) expect(() => parseRecipeContent({ ...recipe, ...patch })).toThrow();
    for (const amount of ['0', '-1', '1/0', 'NaN', '1e99', '1–2', 'etwas\u202e', '<b>some</b>']) expect(() => parseRecipeContent({ ...recipe, ingredients: [{ ...recipe.ingredients[0], amount }] })).toThrow();
  });
});
