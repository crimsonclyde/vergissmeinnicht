import { useEffect, useRef, useState } from 'react';
import { api, messageFor, type RecipeView } from '../../api.ts';
import { t } from '../../i18n/index.ts';
type List = Awaited<ReturnType<typeof api.lists>>[number];
type Item = { ingredient: number; title: string; quantity: string; unit: string; selected: boolean; exact: string; review: boolean };

export function RecipeShopping({ workspaceId, recipe }: { workspaceId: string; recipe: RecipeView }) {
  const [lists, setLists] = useState<List[]>([]);
  const [destination, setDestination] = useState('');
  const [servings, setServings] = useState(recipe.servings);
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const pending=useRef<import('@vergissmeinnicht/domain').RecipeTransfer|null>(null);
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  useEffect(() => { let active = true; api.lists(workspaceId).then(result => { if (active) { setLists(result); if (result.length === 1) setDestination(result[0]?.id ?? ''); } }, error => { if (active) setMessage(messageFor(error)); }); return () => { active = false; }; }, [workspaceId]);
  useEffect(() => {
    let active = true;
    if (!Number.isInteger(servings) || servings < 1 || servings > 1000) { return; }
    api.recipeIngredients(workspaceId, recipe.id, servings).then(result => {
      if (!active) return;
      setItems(result.ingredients.map((item, ingredient) => ({ ingredient, title: item.name + (item.note ? ` (${item.note})` : ''), quantity: item.quantity ?? '', unit: item.unit, selected: true, exact: item.exactAmount, review: item.requiresReview })));
      setOperation(crypto.randomUUID()); setLoading(false);
    }, error => { if (active) { setMessage(messageFor(error)); setLoading(false); } });
    return () => { active = false; };
  }, [workspaceId, recipe.id, recipe.revision, servings]);
  function edit(index: number, patch: Partial<Item>) { setItems(items.map((item, i) => i === index ? { ...item, ...patch } : item)); setOperation(crypto.randomUUID()); setStatus(''); }
  async function add(event: React.SubmitEvent) {
    event.preventDefault(); setBusy(true); setMessage(''); setStatus('');
    try {
      const target = pending.current?.operationId===operation?null:await api.list(workspaceId, destination);
      const input=pending.current?.operationId===operation?pending.current:{ operationId: operation, recipeRevision: recipe.revision, listId: destination, listRevision: target?.revision??0, servings, items: items.filter(item => item.selected).map(item => ({ ingredient: item.ingredient, title: item.title, quantity: item.quantity || null, unit: item.unit || null })) };
      pending.current=input;
      const result=await api.recipeShopping(workspaceId,recipe.id,input);
      setStatus(t('recipes.shoppingAdded', { count: result.itemIds.length }));
      // Keep the operation id after success: a repeated submit is the same request, not a second batch.
    } catch (error) { setMessage(messageFor(error)); } finally { setBusy(false); }
  }
  return <section className="card stack" aria-label={t('recipes.shopping')}>
    <h3>{t('recipes.shopping')}</h3>
    <p>{t('recipes.shoppingHint')}</p>
    {message && <p role="alert">{message}</p>}{status && <p role="status">{status}</p>}
    <form className="stack" onSubmit={event => void add(event)}><fieldset className="stack" disabled={busy}>
      <label>{t('recipes.targetServings')}<input type="number" required min="1" max="1000" step="1" value={servings} onChange={event => {setLoading(true);setStatus('');setItems([]);setServings(Number(event.target.value));}} /></label>
      <label>{t('recipes.destination')}<select required value={destination} onChange={event => { setDestination(event.target.value); setOperation(crypto.randomUUID()); setStatus(''); }}><option value="">{t('recipes.chooseList')}</option>{lists.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      {loading ? <p>{t('journal.loading')}</p> : items.map((item, index) => <fieldset key={item.ingredient} className="card stack"><legend>{t('recipes.ingredientNumber', { count: index + 1 })}</legend>
        <label className="row"><input type="checkbox" checked={item.selected} onChange={event => edit(index, { selected: event.target.checked })} />{t('recipes.include')}</label>
        <label>{t('recipes.ingredientName')}<input maxLength={120} required={item.selected} value={item.title} onChange={event => edit(index, { title: event.target.value })} /></label>
        <label>{t('recipes.amount')}<input required={item.selected && item.review} value={item.quantity} onChange={event => edit(index, { quantity: event.target.value })} /></label>
        {item.review && <p>{t('recipes.exactAmount', { amount: item.exact })}</p>}
        <label>{t('recipes.unit')}<input maxLength={16} value={item.unit} onChange={event => edit(index, { unit: event.target.value })} /></label>
      </fieldset>)}
      <button type="submit" className="primary" disabled={loading || !items.some(item => item.selected) || status !== ''}>{t('recipes.addShopping')}</button>
    </fieldset></form>
  </section>;
}
