import { useEffect, useRef, useState } from 'react';
import type { RecipeTransfer } from '@vergissmeinnicht/domain';
import { api, ApiError, messageFor, type RecipeView } from '../../api.ts';
import { t } from '../../i18n/index.ts';

type List = Awaited<ReturnType<typeof api.lists>>[number];

export function RecipeShopping({ workspaceId, recipe }: { workspaceId: string; recipe: RecipeView }) {
  const [lists, setLists] = useState<List[]>();
  const [destination, setDestination] = useState('');
  const [servings, setServings] = useState(String(recipe.servings ?? ''));
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<RecipeTransfer | null>(null);

  useEffect(() => {
    let active = true;
    api.lists(workspaceId).then(result => {
      if (!active) return;
      const shopping = result.filter(list => list.kind === 'GROCERY');
      setLists(shopping);
      if (shopping.length === 1 && shopping[0]) setDestination(shopping[0].id);
    }, error => { if (active) setMessage(messageFor(error)); });
    return () => { active = false; };
  }, [workspaceId]);

  function change() {
    pending.current = null;
    setMessage('');
    setStatus('');
  }

  async function add(event: React.SubmitEvent) {
    event.preventDefault();
    if (busy || status || !destination) return;
    setBusy(true);
    setMessage('');
    try {
      if (!pending.current) {
        const target = await api.list(workspaceId, destination);
        pending.current = {
          operationId: crypto.randomUUID(), recipeRevision: recipe.revision,
          listId: destination, listRevision: target.revision,
          servings: recipe.servings === null ? null : Number(servings),
        };
      }
      const result = await api.recipeShopping(workspaceId, recipe.id, pending.current);
      setStatus(result.itemIds.length === 1 ? t('recipes.shoppingAddedOne') : t('recipes.shoppingAdded', { count: result.itemIds.length }));
    } catch (error) {
      // Reuse the submitted payload if a response was lost or the server returned an unexpected error.
      if (error instanceof ApiError && error.status === 409) pending.current = null;
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  return <section className="card stack" aria-label={t('recipes.shopping')}>
    <h3>{t('recipes.shopping')}</h3>
    {recipe.servings === null && <p>{t('recipes.noBaseServings')}</p>}
    {message && <p role="alert">{message}</p>}
    {status && <p role="status">{status}</p>}
    {lists?.length === 0 && <p>{t('recipes.noShoppingLists')}</p>}
    {lists && lists.length > 0 && <form onSubmit={event => void add(event)}>
      <fieldset className="recipe-shopping-fields" disabled={busy}>
        {recipe.servings !== null && <label>{t('recipes.targetServings')}
          <input type="number" required min="1" max="1000" step="1" value={servings} onChange={event => { change(); setServings(event.target.value); }} />
        </label>}
        <label>{t('recipes.destination')}
          <select required value={destination} onChange={event => { change(); setDestination(event.target.value); }}>
            <option value="">{t('recipes.chooseList')}</option>
            {lists.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <button type="submit" className="primary" disabled={!destination || !!status}>{t('recipes.addShopping')}</button>
      </fieldset>
    </form>}
  </section>;
}
