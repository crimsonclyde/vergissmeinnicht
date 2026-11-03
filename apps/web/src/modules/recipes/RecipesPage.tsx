import { RecipeForm } from './RecipeForm.tsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RecipeContent } from '@vergissmeinnicht/domain';
import { api, messageFor, recipeAttachmentClient, type RecipeView } from '../../api.ts';
import { t } from '../../i18n/index.ts';
import { Markdown } from '../../markdown/Markdown.tsx';
import { setNavigationGuard } from '../../router.tsx';
import { RecipeShopping } from './RecipeShopping.tsx';
const fresh = (): RecipeContent => ({ version: 1, title: '', servings: 2, ingredients: [{ name: '', amount: '', unit: '', note: '' }], instructions: '', tags: [], source: '', prepMinutes: null, cookMinutes: null });
const contentOf = (recipe: RecipeView): RecipeContent => ({ version: 1, title: recipe.title, servings: recipe.servings, ingredients: recipe.ingredients, instructions: recipe.instructions, tags: recipe.tags, source: recipe.source, prepMinutes: recipe.prepMinutes, cookMinutes: recipe.cookMinutes });

export function RecipesPage({ workspaceId, canWrite, canShop }: { workspaceId: string; canWrite: boolean; canShop: boolean }) {
  const [records, setRecords] = useState<RecipeView[]>([]);
  const [selected, setSelected] = useState<RecipeView | null>(null);
  const [draft, setDraft] = useState<RecipeContent | null>(null);
  const [original, setOriginal] = useState('');
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const editing=draft!==null;
  const [sourceMode, setSourceMode] = useState(false);
  const client = useMemo(() => recipeAttachmentClient(workspaceId), [workspaceId]);
  const dirty = draft !== null && JSON.stringify(draft) !== original;
  const leave = useCallback(() => !dirty || window.confirm(t('journal.unsaved')), [dirty]);
  useEffect(() => {
    setNavigationGuard(leave);
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    window.dispatchEvent(new CustomEvent('vmn-journal-editing', { detail: editing }));
    return () => { setNavigationGuard(null); window.removeEventListener('beforeunload', warn); window.dispatchEvent(new CustomEvent('vmn-journal-editing', { detail: false })); };
  }, [dirty, leave, editing]);
  useEffect(() => { let active = true; api.recipes(workspaceId, query, archived, offset).then(result => { if (active) { setRecords(result.recipes); setMore(result.more); } }, error => { if (active) setMessage(messageFor(error)); }); return () => { active = false; }; }, [workspaceId, query, archived, offset]);
  const showError = useCallback((message: string) => setMessage(message), []);
  function change(content: RecipeContent) { setDraft(content); setStatus(''); }
  function insert(markdown: string) { setDraft(previous => previous ? { ...previous, instructions: previous.instructions + '\n\n' + markdown } : previous); setEditorKey(value => value + 1); setStatus(''); }
  function edit(recipe: RecipeView | null) { if (!leave()) return; setSelected(recipe); const next = recipe ? contentOf(recipe) : fresh(); setDraft(next); setOriginal(JSON.stringify(next)); setMessage(''); setStatus(''); setEditorKey(value => value + 1); }
  async function save(content: RecipeContent, archive = selected?.archived ?? false) {
    setBusy(true); setStatus(''); setMessage('');
    try {
      const result = await api.saveRecipe(workspaceId, selected?.id, content, selected?.revision ?? 0, archive);
      setSelected(result); setDraft(null); setOriginal(''); setStatus(t('recipes.saved'));
      const list = await api.recipes(workspaceId, query, archived, offset); setRecords(list.recipes); setMore(list.more);
    } catch (error) { setMessage(messageFor(error)); } finally { setBusy(false); }
  }
  function resolveImage(path: string, kind = 'preview') { const match = /^attachments\/([0-9a-f-]{36})\.(jpg|png)$/.exec(path); return match?.[1] ? client.url(match[1], kind) : undefined; }
  const Heading = draft ? 'h1' : 'h2';
  return <section className="stack recipe-page" data-editing={editing}><Heading>{t('recipes.heading')}</Heading>{!editing && <p className="muted">{t('recipes.hint')}</p>}
    {message && <p role="alert">{message}</p>}{status && <p role="status">{status}</p>}
    {draft ? <RecipeForm
      draft={draft} busy={busy} editorKey={editorKey} sourceMode={sourceMode}
      client={client} workspaceId={workspaceId} selectedId={selected?.id}
      onSourceModeChange={setSourceMode} onChange={change} onInsert={insert} onError={showError}
      onSave={() => void save(draft)} onCancel={() => { if (leave()) { setDraft(null); setStatus(''); } }}
    /> : selected ? <>
      <button type="button" onClick={() => { setSelected(null); setStatus(''); }}>{t('recipes.back')}</button>
      <a className="button quiet" href={`/api/workspaces/${workspaceId}/recipes/${selected.id}/export`} download>{t('recipes.export')}</a>
      <article className="card stack"><h3>{selected.title}</h3><p>{t('recipes.serves', { count: selected.servings })}</p>
        <ul>{selected.ingredients.map((item, index) => <li key={index}>{[item.amount, item.unit, item.name, item.note].filter(Boolean).join(' · ')}</li>)}</ul>
        <Markdown source={selected.instructions} resolveImage={resolveImage} resolveOriginal={path => resolveImage(path, 'original')} />
        {selected.source && <a href={selected.source} rel="noopener noreferrer">{t('recipes.source')}</a>}
        {canWrite && <div className="row wrap"><button type="button" disabled={busy} onClick={() => edit(selected)}>{t('recipes.edit')}</button><button type="button" disabled={busy} onClick={() => void save(contentOf(selected), !selected.archived)}>{t(selected.archived ? 'recipes.restore' : 'recipes.archive')}</button></div>}
      </article>
      {canShop && !selected.archived && <RecipeShopping key={selected.id + selected.revision} workspaceId={workspaceId} recipe={selected} />}
    </> : <>
      <a className="button quiet" href={`/api/workspaces/${workspaceId}/recipes/export`} download>{t('recipes.exportAll')}</a>
      {canWrite && <button type="button" className="primary" onClick={() => edit(null)}>{t('recipes.new')}</button>}
      <label>{t('recipes.search')}<input maxLength={100} value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} /></label>
      <label className="row"><input type="checkbox" checked={archived} onChange={event => { setArchived(event.target.checked); setOffset(0); }} />{t('recipes.showArchived')}</label>
      {records.length === 0 && <p>{t('recipes.empty')}</p>}
      <ul className="plain-list stack">{records.map(recipe => <li key={recipe.id}><button type="button" className="card link-card" onClick={() => { setMessage(''); void api.recipe(workspaceId, recipe.id).then(setSelected, error => setMessage(messageFor(error))); }}>{recipe.title} · {t('recipes.serves', { count: recipe.servings })}</button></li>)}</ul>
      <div className="row"><button type="button" disabled={offset === 0} onClick={() => setOffset(offset - 30)}>{t('journal.previous')}</button><button type="button" disabled={!more} onClick={() => setOffset(offset + 30)}>{t('journal.more')}</button></div>
    </>}
  </section>;
}
