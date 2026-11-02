import { Readable } from 'node:stream';
import yazl from 'yazl';
import { exportSegment, type RecipeContent } from '@vergissmeinnicht/domain';
const literal = (value: string) => value.replace(/([\\`*_{}[\]<>()#+.!|~-])/g, '\\$1');
export function recipeMarkdown(recipe: RecipeContent): string {
  const meta = { title: recipe.title, servings: recipe.servings, tags: recipe.tags, preparation_minutes: recipe.prepMinutes, cooking_minutes: recipe.cookMinutes, source: recipe.source };
  const front = Object.entries(meta).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
  return `---\n${front}\n---\n\n# ${literal(recipe.title)}\n\n## Ingredients\n\n${recipe.ingredients.map(item => '- ' + literal([item.amount, item.unit, item.name, item.note].filter(Boolean).join(' '))).join('\n')}\n\n## Instructions\n\n${recipe.instructions}\n`;
}
export interface RecipeArchiveFile { path: string; bytes: number; name: string; sha256: string; open(): Promise<AsyncIterable<Uint8Array>> }
export function recipeArchive(recipes: readonly { id: string; content: RecipeContent; archived: boolean }[], files: readonly RecipeArchiveFile[]) {
  const zip = new yazl.ZipFile();
  for (const recipe of recipes) zip.addBuffer(Buffer.from(recipeMarkdown(recipe.content), 'utf8'), `recipes/${exportSegment(recipe.content.title)}-${recipe.id}.md`);
  for (const file of files) zip.addReadStreamLazy('recipes/' + file.path, { size: file.bytes }, callback => { file.open().then(stream => callback(null, Readable.from(stream)), error => callback(error, Readable.from([]))); });
  zip.addBuffer(Buffer.from(JSON.stringify({ version: 1, recipes, files: files.map(file => ({ path: file.path, name: file.name, bytes: file.bytes, sha256: file.sha256 })) }, null, 2), 'utf8'), 'recipes/metadata.json');
  zip.addBuffer(Buffer.from(JSON.stringify(recipes.map(({ content }) => ({ '@context': 'https://schema.org', '@type': 'Recipe', name: content.title, recipeYield: `${content.servings} servings`, recipeIngredient: content.ingredients.map(item => [item.amount, item.unit, item.name, item.note].filter(Boolean).join(' ')), recipeInstructions: content.instructions, keywords: content.tags.join(', '), ...(content.prepMinutes === null ? {} : { prepTime: `PT${content.prepMinutes}M` }), ...(content.cookMinutes === null ? {} : { cookTime: `PT${content.cookMinutes}M` }), ...(content.source ? { isBasedOn: content.source } : {}) })), null, 2), 'utf8'), 'recipes/recipes.jsonld');
  zip.end(); return zip.outputStream;
}
