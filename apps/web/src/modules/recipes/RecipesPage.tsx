import { RecipeForm } from './RecipeForm.tsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RECIPE_CATEGORIES, RECIPE_SORTS, recipeCategories, recipeCover, recipeImages, type RecipeCategory, type RecipeContent, type RecipeSort } from '@vergissmeinnicht/domain';
import { UiIcon } from '../../ui-icons.tsx';
import { api, messageFor, recipeAttachmentClient, type RecipeView } from '../../api.ts';
import { t } from '../../i18n/index.ts';
import { Markdown } from '../../markdown/Markdown.tsx';
import { setNavigationGuard } from '../../router.tsx';
import { RecipeShopping } from './RecipeShopping.tsx';
import { RecipePhoto } from './RecipePhoto.tsx';
import './cookbook.css';
const fresh = (): RecipeContent => ({ version: 1, title: '', servings: null, ingredients: [{ name: '', amount: '', unit: '', note: '' }], instructions: '', tags: [], categories: [], source: '', prepMinutes: null, cookMinutes: null, private: false });
const contentOf = (recipe: RecipeView): RecipeContent => ({ version: 1, title: recipe.title, servings: recipe.servings, ingredients: recipe.ingredients, instructions: recipe.instructions, tags: recipe.tags, categories: recipe.categories ?? [], source: recipe.source, prepMinutes: recipe.prepMinutes, cookMinutes: recipe.cookMinutes, private: recipe.private, ...(recipe.coverImage ? { coverImage: recipe.coverImage } : {}) });

type LibraryView = 'cards' | 'list';
const VIEW_KEY = 'vmn.recipeView';
/** Remembered per viewer (a convenience only); cards are the default. */
function storedView(): LibraryView {
  try { return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'; } catch { return 'cards'; }
}
function rememberView(view: LibraryView) {
  try { window.localStorage.setItem(VIEW_KEY, view); } catch { /* per-viewer convenience only */ }
}

export function RecipesPage({ workspaceId, canWrite, canShop }: { workspaceId: string; canWrite: boolean; canShop: boolean }) {
  const [library, setLibrary] = useState<{ key: string; records: RecipeView[]; more: boolean }>();
  const [selected, setSelected] = useState<RecipeView | null>(null);
  const [draft, setDraft] = useState<RecipeContent | null>(null);
  const [original, setOriginal] = useState('');
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [categories, setCategories] = useState<RecipeCategory[]>([]);
  const [sort, setSort] = useState<RecipeSort>('newest');
  const [view, setView] = useState<LibraryView>(storedView);
  const libraryKey = JSON.stringify([workspaceId, query, archived, offset, categories, sort]);
  const filter = useMemo(() => ({ categories, sort }), [categories, sort]);
  const filtered = query !== '' || categories.length > 0;
  function toggleCategory(category: RecipeCategory) {
    setCategories(previous => previous.includes(category) ? previous.filter(value => value !== category) : RECIPE_CATEGORIES.filter(value => value === category || previous.includes(value)));
    setOffset(0);
  }
  function changeView(next: LibraryView) { setView(next); rememberView(next); }
  const loading = library?.key !== libraryKey;
  const records = loading ? [] : library.records;
  const more = !loading && library.more;
  const [startWithImages, setStartWithImages] = useState(false);
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
  useEffect(() => { let active = true; api.recipes(workspaceId, query, archived, offset, filter).then(result => { if (active) setLibrary({ key: libraryKey, records: result.recipes, more: result.more }); }, error => { if (active) { setMessage(messageFor(error)); setLibrary({ key: libraryKey, records: [], more: false }); } }); return () => { active = false; }; }, [workspaceId, query, archived, offset, filter, libraryKey]);
  const showError = useCallback((message: string) => setMessage(message), []);
  function change(content: RecipeContent) {
    const { coverImage, ...body } = content;
    setDraft(coverImage && recipeImages(content).some(image => image.url === coverImage) ? content : body);
    setStatus('');
  }
  function insert(markdown: string) { setDraft(previous => previous ? { ...previous, instructions: previous.instructions + '\n\n' + markdown } : previous); setEditorKey(value => value + 1); setStatus(''); }
  function edit(recipe: RecipeView | null, images = false) { if (!leave()) return; setStartWithImages(images); setSelected(recipe); const next = recipe ? contentOf(recipe) : fresh(); setDraft(next); setOriginal(JSON.stringify(next)); setMessage(''); setStatus(''); setEditorKey(value => value + 1); }
  async function save(content: RecipeContent, archive = selected?.archived ?? false) {
    setBusy(true); setStatus(''); setMessage('');
    try {
      const result = await api.saveRecipe(workspaceId, selected?.id, content, selected?.revision ?? 0, archive);
      setSelected(result); setDraft(null); setOriginal(''); setStatus(t('recipes.saved'));
      const list = await api.recipes(workspaceId, query, archived, offset, filter); setLibrary({ key: libraryKey, records: list.recipes, more: list.more });
    } catch (error) { setMessage(messageFor(error)); } finally { setBusy(false); }
  }
  const canEditSelected = canWrite && selected?.inCurrentWorkspace;
  function imageUrl(recipeId: string, attachmentId: string, kind: 'original' | 'preview' | 'thumbnail') {
    return `/api/workspaces/${workspaceId}/recipes/${recipeId}/attachments/${attachmentId}/${kind}`;
  }
  function resolveImage(path: string, kind: 'original' | 'preview' = 'preview') {
    const match = /^attachments\/([0-9a-f-]{36})\.(jpg|png)$/.exec(path);
    return selected && match?.[1] ? imageUrl(selected.id, match[1], kind) : undefined;
  }
  const Heading = draft ? 'h1' : 'h2';
  return <section className="stack recipe-page" data-editing={editing}>{(editing || selected) && <Heading>{t('recipes.heading')}</Heading>}
    {message && <p role="alert">{message}</p>}{status && <p role="status">{status}</p>}
    {draft ? <RecipeForm
      draft={draft} startWithImages={startWithImages} busy={busy} editorKey={editorKey} sourceMode={sourceMode}
      client={client} workspaceId={workspaceId} selectedId={selected?.id}
      onSourceModeChange={setSourceMode} onChange={change} onInsert={insert} onError={showError}
      onSave={() => void save(draft)} onCancel={() => { if (leave()) { setDraft(null); setStatus(''); } }}
    /> : selected ? <>
      <button type="button" onClick={() => { setSelected(null); setStatus(''); }}>{t('recipes.back')}</button>
      <a className="button quiet" href={`/api/workspaces/${workspaceId}/recipes/${selected.id}/export`} download>{t('recipes.export')}</a>
      <article className="card stack"><h3>{selected.title}</h3><RecipeFacts recipe={selected} />
        <RecipeCategories recipe={selected} />
        <RecipeLabels recipe={selected} />
        <p className="muted">{t(selected.private ? 'recipes.privateStatus' : 'recipes.sharedStatus')}</p>
        {!recipeCover(selected) && <div className="recipe-no-photo">
          <RecipePhoto />
          {canEditSelected && <button type="button" disabled={busy} onClick={() => edit(selected, true)}>{t('recipes.addPhoto')}</button>}
        </div>}
        <ul>{selected.ingredients.map((item, index) => <li key={index}>{[item.amount, item.unit, item.name, item.note].filter(Boolean).join(' · ')}</li>)}</ul>
        {canEditSelected && recipeCover(selected) && <div><button type="button" disabled={busy} onClick={() => edit(selected, true)}>{t('recipes.managePhotos')}</button></div>}
        <Markdown source={selected.instructions} resolveImage={resolveImage} resolveOriginal={path => resolveImage(path, 'original')} />
        {selected.source && <a href={selected.source} rel="noopener noreferrer">{t('recipes.source')}</a>}
        {canEditSelected && <div className="row wrap"><button type="button" disabled={busy} onClick={() => edit(selected)}>{t('recipes.edit')}</button><button type="button" disabled={busy} onClick={() => void save(contentOf(selected), !selected.archived)}>{t(selected.archived ? 'recipes.restore' : 'recipes.archive')}</button></div>}
      </article>
      {canShop && !selected.archived && <RecipeShopping key={`${workspaceId}/${selected.id}/${selected.revision}`} workspaceId={workspaceId} recipe={selected} />}
    </> : <>
      <header className="recipe-library-heading">
        <div><h2>{t('recipes.heading')}</h2><p className="muted">{t('recipes.hint')}</p></div>
        <div className="row">
          {canWrite && <button type="button" className="primary" onClick={() => edit(null)}><UiIcon name="add" />{t('recipes.new')}</button>}
          <a className="button quiet icon-button" href={`/api/workspaces/${workspaceId}/recipes/export`} download aria-label={t('recipes.exportAll')} title={t('recipes.exportAll')}><UiIcon name="download" /></a>
        </div>
      </header>
      <section className="recipe-filters" aria-label={t('recipes.filters')}>
        <div className="recipe-filter-row">
          <label className="recipe-search"><UiIcon name="search" /><span className="visually-hidden">{t('recipes.search')}</span><input type="search" maxLength={100} value={query} placeholder={t('recipes.search')} onChange={event => { setQuery(event.target.value); setOffset(0); }} /></label>
          <label className="recipe-sort"><UiIcon name="sort" /><span className="visually-hidden">{t('recipes.sort')}</span>
            <select value={sort} onChange={event => { setSort(event.target.value as RecipeSort); setOffset(0); }}>{RECIPE_SORTS.map(value => <option key={value} value={value}>{t(`recipes.sort.${value}`)}</option>)}</select>
          </label>
          <div className="recipe-view-toggle" role="group" aria-label={t('recipes.view')}>
            {(['cards', 'list'] as const).map(value => <button key={value} type="button" className="icon-button" aria-pressed={view === value} aria-label={t(value === 'cards' ? 'recipes.cardView' : 'recipes.listView')} title={t(value === 'cards' ? 'recipes.cardView' : 'recipes.listView')} onClick={() => changeView(value)}><UiIcon name={value === 'cards' ? 'grid' : 'listView'} /></button>)}
          </div>
          <button type="button" className="icon-button recipe-archived-toggle" aria-pressed={archived} aria-label={t('recipes.showArchived')} title={t('recipes.showArchived')} onClick={() => { setArchived(!archived); setOffset(0); }}><UiIcon name="archive" /></button>
        </div>
        <div className="recipe-category-chips" role="group" aria-label={t('recipes.categories')}>
          <button type="button" aria-pressed={categories.length === 0} onClick={() => { setCategories([]); setOffset(0); }}>{t('recipes.allCategories')}</button>
          {RECIPE_CATEGORIES.map(category => <button key={category} type="button" aria-pressed={categories.includes(category)} onClick={() => toggleCategory(category)}>{t(`recipes.category.${category}`)}</button>)}
        </div>
      </section>
      {loading && <ul className={view === 'list' ? 'recipe-list' : 'recipe-grid'} aria-hidden="true">{[1, 2, 3].map(key => <li key={key}><div className="recipe-tile recipe-tile-skeleton"><span className="recipe-photo" data-photo="loading" /><span className="recipe-caption" /></div></li>)}</ul>}
      {!loading && !message && records.length === 0 && <p>{t(filtered ? 'recipes.emptyFiltered' : 'recipes.empty')}</p>}
      <ul className={view === 'list' ? 'recipe-list' : 'recipe-grid'} aria-busy={loading}>{records.map(recipe => {
        const cover = recipeCover(recipe);
        return <li key={recipe.id}><button type="button" className="recipe-tile" onClick={() => { setMessage(''); void api.recipe(workspaceId, recipe.id).then(setSelected, error => setMessage(messageFor(error))); }}>
          <RecipePhoto key={cover?.id ?? 'empty'} src={cover ? imageUrl(recipe.id, cover.id, 'thumbnail') : undefined} />
          <span className="recipe-caption"><strong>{recipe.title}</strong><RecipeCategories recipe={recipe} /><RecipeFacts recipe={recipe} />
            {view === 'cards' && <RecipeLabels recipe={recipe} />}
            {view === 'cards' && recipe.tags.length > 0 && <span className="recipe-tags">{recipe.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</span>}
          </span>
        </button></li>;
      })}</ul>
      {(offset > 0 || more) && <div className="row"><button type="button" disabled={offset === 0} onClick={() => setOffset(offset - 30)}>{t('journal.previous')}</button><button type="button" disabled={!more} onClick={() => setOffset(offset + 30)}>{t('journal.more')}</button></div>}
    </>}
  </section>;
}

function RecipeCategories({ recipe }: { recipe: Pick<RecipeContent, 'categories'> }) {
  const categories = recipeCategories(recipe);
  return categories.length > 0 ? <span className="recipe-tags recipe-categories">{categories.map(category => <span key={category}>{t(`recipes.category.${category}`)}</span>)}</span> : null;
}

function RecipeLabels({ recipe }: { recipe: RecipeView }) {
  return <span className="recipe-tags recipe-labels">
    <span>{t(recipe.private ? 'recipes.privateLabel' : 'recipes.publicLabel')}</span>
    <span>{t('recipes.workspaceLabel', { name: recipe.homeWorkspaceName })}</span>
  </span>;
}

function RecipeFacts({ recipe }: { recipe: RecipeContent }) {
  return <span className="recipe-facts">
    {recipe.prepMinutes !== null && <span>{t('recipes.prepShort', { count: recipe.prepMinutes })}</span>}
    {recipe.cookMinutes !== null && <span>{t('recipes.cookShort', { count: recipe.cookMinutes })}</span>}
    {recipe.servings !== null && <span>{t('recipes.serves', { count: recipe.servings })}</span>}
  </span>;
}
