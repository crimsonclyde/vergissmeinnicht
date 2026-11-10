import { lazy, Suspense, useId, useState, type FormEvent } from 'react';
import { recipeImages, type RecipeContent } from '@vergissmeinnicht/domain';
import { messageFor, type recipeAttachmentClient } from '../../api.ts';
import { AttachmentPanel, imageReference } from '../../attachments/AttachmentPanel.tsx';
import { t } from '../../i18n/index.ts';
import { MobileActionBar } from '../../mobile/MobileActionBar.tsx';
import { PhoneFlowHeading, usePhoneEditorFlow } from '../../mobile/PhoneEditorFlow.tsx';
import { RecipeImageGenerator } from './RecipeImageGenerator.tsx';
import './recipe-form.css';

const Editor = lazy(() => import('../../markdown/MarkdownEditor.tsx').then(module => ({ default: module.MarkdownEditor })));
const STAGES = ['title', 'ingredients', 'instructions', 'details'] as const;
const HEADINGS = { title: 'recipes.phoneTitle', ingredients: 'recipes.ingredients', instructions: 'recipes.instructions', details: 'recipes.phoneDetails' } as const;

/** One in-memory draft and one explicit Save; phone stages never issue a Recipe mutation. */
export function RecipeForm(props: {
  draft: RecipeContent; startWithImages: boolean; busy: boolean; editorKey: number; sourceMode: boolean;
  workspaceId: string; selectedId: string | undefined; client: ReturnType<typeof recipeAttachmentClient>;
  onChange: (value: RecipeContent) => void; onInsert: (markdown: string) => void;
  onError: (message: string) => void; onSourceModeChange: (source: boolean) => void;
  onSave: () => void; onCancel: () => void;
}) {
  const { draft, busy, client, onChange } = props;
  const [activeIngredient, setActiveIngredient] = useState(0);
  const [tagText, setTagText] = useState<string | null>(null);
  const id = useId();
  const flow = usePhoneEditorFlow({ stages: STAGES, busy, initialStage: props.startWithImages ? 'details' : 'title', onReveal: field => {
    const index = field.closest<HTMLElement>('[data-ingredient]')?.dataset.ingredient;
    if (index !== undefined) setActiveIngredient(Number(index));
  } });
  const { compact, stage, form, next: advance } = flow;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (compact && stage !== 'details') advance();
    else props.onSave();
  }
  function addIngredient() {
    setActiveIngredient(draft.ingredients.length);
    onChange({ ...draft, ingredients: [...draft.ingredients, { name: '', amount: '', unit: '', note: '' }] });
  }
  const images = recipeImages(draft);
  const cover = images.find(image => image.url === draft.coverImage) ?? images[0];
  const resolveImage = (path: string) => { const match = /^attachments\/([0-9a-f-]{36})\.(jpg|png)$/.exec(path); return match?.[1] ? client.url(match[1], 'preview') : undefined; };
  return <div className="card stack recipe-editor" data-compact={compact}>
    {!compact && <button type="button" disabled={busy} onClick={props.onCancel}>{t('recipes.cancelEdit')}</button>}
    {compact && <PhoneFlowHeading title={t(HEADINGS[stage])} headingRef={flow.heading} index={flow.index} count={flow.count} />}
    <form id={id} ref={form} className="stack" onSubmit={submit} onInvalidCapture={flow.onInvalid}><fieldset className="stack" disabled={busy}>
      <section className="stack" data-editor-stage="title" hidden={compact && stage !== 'title'}>
        <label>{t('journal.title')}<input required pattern=".*\S.*" maxLength={160} value={draft.title} onKeyDown={event => { if (compact && event.key === 'Enter') { event.preventDefault(); advance(); } }} onChange={event => onChange({ ...draft, title: event.target.value })} /></label>
      </section>
      <section className="stack" data-editor-stage="ingredients" hidden={compact && stage !== 'ingredients'}>
        <label>{t('recipes.baseServings')}<input type="number" required min="1" max="1000" step="1" value={draft.servings} onChange={event => onChange({ ...draft, servings: Number(event.target.value) })} /></label>
        {!compact && <h3>{t('recipes.ingredients')}</h3>}
        {draft.ingredients.map((ingredient, index) => <details className="recipe-ingredient" key={index} open={!compact || activeIngredient === index}>
          <summary hidden={!compact} onClick={event => { event.preventDefault(); setActiveIngredient(index); }}>{ingredient.name || t('recipes.ingredientNumber', { count: index + 1 })}</summary>
          <fieldset className="stack" data-ingredient={index}><legend>{t('recipes.ingredientNumber', { count: index + 1 })}</legend>
            {(['name', 'amount', 'unit', 'note'] as const).map(key => <label key={key}>{t(key === 'name' ? 'recipes.ingredientName' : key === 'amount' ? 'recipes.amount' : key === 'unit' ? 'recipes.unit' : 'recipes.note')}<input required={key === 'name'} pattern={key === 'name' ? '.*\\S.*' : undefined} maxLength={key === 'name' ? 120 : key === 'amount' ? 32 : key === 'unit' ? 16 : 160} value={ingredient[key]} onChange={event => onChange({ ...draft, ingredients: draft.ingredients.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item) })} /></label>)}
            {!compact && <button type="button" disabled={draft.ingredients.length === 1} onClick={() => onChange({ ...draft, ingredients: draft.ingredients.filter((_, i) => i !== index) })}>{t('recipes.removeIngredient')}</button>}
          </fieldset>
        </details>)}
        {!compact && <button type="button" disabled={draft.ingredients.length >= 100} onClick={addIngredient}>{t('recipes.addIngredient')}</button>}
      </section>
      <section className="stack" data-editor-stage="instructions" hidden={compact && stage !== 'instructions'}>
        {!compact && <h3>{t('recipes.instructions')}</h3>}
        {(!compact || flow.hasVisited('instructions') || stage === 'instructions') && <div inert={busy}><Suspense fallback={<p>{t('journal.loading')}</p>}><Editor key={props.editorKey} visualOnly={compact} value={draft.instructions} sourceMode={props.sourceMode} onSourceModeChange={props.onSourceModeChange} resolveImage={resolveImage} onChange={instructions => onChange({ ...draft, instructions })} upload={async file => { try { return imageReference(await client.upload(file)); } catch (error) { props.onError(messageFor(error)); throw error; } }} /></Suspense></div>}
      </section>
      <section className="stack" data-editor-stage="details" hidden={compact && stage !== 'details'}>
        <div className="row wrap">{(['prepMinutes', 'cookMinutes'] as const).map(key => <label key={key}>{t(key === 'prepMinutes' ? 'recipes.prep' : 'recipes.cook')}<input type="number" min="0" max="10080" value={draft[key] ?? ''} onChange={event => onChange({ ...draft, [key]: event.target.value === '' ? null : Number(event.target.value) })} /></label>)}</div>
        <label>{t('journal.tags')}<input value={tagText ?? draft.tags.join(', ')} onChange={event => { setTagText(event.target.value); onChange({ ...draft, tags: event.target.value.split(',').map(tag => tag.trim()).filter(Boolean) }); }} /></label>
        <label>{t('recipes.source')}<input type="url" maxLength={2048} value={draft.source} onChange={event => onChange({ ...draft, source: event.target.value })} /></label>
        <label className="row"><input type="checkbox" checked={draft.private ?? false} onChange={event => onChange({ ...draft, private: event.target.checked })} />{t('recipes.private')}</label>
        <p className="muted">{t(draft.private ? 'recipes.privateStatus' : 'recipes.sharedStatus')}</p>
        <details className="recipe-images" open={!compact || props.startWithImages ? true : undefined}><summary hidden={!compact}>{t('journal.filesScreen')}</summary><div className="stack">
          <p className="muted">{t('recipes.photoHint')}</p>
          {cover && <div className="recipe-cover-picker">
            <img src={client.url(cover.id, 'thumbnail')} alt="" />
            <label>{t('recipes.coverPhoto')}<select value={cover.url} onChange={event => onChange({ ...draft, coverImage: event.target.value })}>
              {images.map((image, index) => <option key={image.url} value={image.url}>{t('recipes.photoNumber', { count: index + 1 })}</option>)}
            </select></label>
          </div>}
          <RecipeImageGenerator key={props.selectedId ?? props.editorKey} workspaceId={props.workspaceId} onInsert={props.onInsert} />
          <AttachmentPanel initiallyOpen={props.startWithImages} client={client} refreshVersion={props.editorKey} onInsert={props.onInsert} onError={props.onError} allowClipboardImage />
        </div></details>
      </section>
      {!compact && <button type="submit" className="primary">{t('recipes.save')}</button>}
    </fieldset></form>
    {compact && <MobileActionBar label={t('recipes.phoneActions')} actions={[
      { id: 'back', label: t('common.back'), icon: 'back', disabled: busy, onClick: () => flow.back(props.onCancel) },
      { id: 'cancel', label: t('common.cancel'), icon: 'close', disabled: busy, onClick: props.onCancel },
      ...(stage === 'ingredients' ? [
        { id: 'add', label: t('recipes.addIngredient'), icon: 'addStep' as const, disabled: busy || draft.ingredients.length >= 100, onClick: addIngredient },
        { id: 'remove', label: t('recipes.removeIngredient'), icon: 'trash' as const, disabled: busy || draft.ingredients.length <= 1, onClick: () => {
          if (!window.confirm(t('recipes.removeIngredientConfirm', { name: draft.ingredients[activeIngredient]?.name || t('recipes.ingredientNumber', { count: activeIngredient + 1 }) }))) return;
          onChange({ ...draft, ingredients: draft.ingredients.filter((_, index) => index !== activeIngredient) });
          setActiveIngredient(Math.max(0, activeIngredient - 1));
        } },
      ] : []),
    ]} primary={stage === 'details' ? { id: 'save', label: t('recipes.save'), icon: 'save', disabled: busy, type: 'submit', form: id } : { id: 'next', label: t('common.next'), icon: 'forward', disabled: busy, onClick: advance }} />}
  </div>;
}
