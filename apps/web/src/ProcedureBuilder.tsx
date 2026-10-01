import { MAX_SECTIONS_PER_PROCEDURE, MAX_STEPS_PER_PROCEDURE } from '@vergissmeinnicht/domain';
import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { ApiError, api, messageFor, type ImageUsage, type ProcedureContent, type ProcedureDetail, type ProcedureIcon } from './api.ts';
import { FormDialog } from './FormDialog.tsx';
import { clearHandOver, handOver, handedOver } from './handoff.ts';
import { IconPicker } from './IconPicker.tsx';
import { t } from './i18n/index.ts';
import { MoreMenu, type MoreMenuItem } from './MoreMenu.tsx';
import {
  addSteps,
  applyStep,
  canSave,
  draftFrom,
  draftProblems,
  duplicateStep,
  hasProblems,
  locateStep,
  moveSectionBy,
  moveSectionTo,
  moveStepBy,
  moveStepTo,
  newSection,
  previewPastedSteps,
  removeSection,
  removeStep,
  sameContent,
  saveState,
  stepCount,
  toContent,
  updateSection,
  type Draft,
  type DraftProblems,
  type DraftSection,
  type DraftStep,
  type PasteProblem,
  type SaveState,
} from './procedure-draft.ts';
import { AppIcon } from './procedure-icons.tsx';
import { ProcedurePreview } from './ProcedurePreview.tsx';
import { navigate, paths, setNavigationGuard } from './router.tsx';
import { StartControl } from './StartProcedure.tsx';
import { StepEditor } from './StepEditor.tsx';
import { UiIcon } from './ui-icons.tsx';
import { UndoNotice, type Undoable } from './UndoNotice.tsx';

const EMPTY: ProcedureContent = { title: '', description: '', icon: 'checklist', tags: [], sections: [] };
/** Marks the history entry added while the Step editor is open, so Back returns to the outline. */
const EDITOR_STATE = 'vmnStepEditor';
const stepRowId = (key: string) => `step-row-${key}`;
/** After the first save of a new Procedure the builder continues at the Procedure's own address: what it carries over. */
const JUST_SAVED = 'procedure-just-saved';
interface JustSaved {
  readonly id: string;
  readonly openIndex: number;
}

type Dragged = { readonly kind: 'section' | 'step'; readonly key: string };
type Dialog = { readonly kind: 'paste' | 'edit-section' | 'move-step'; readonly key: string } | { readonly kind: 'add-section' } | null;

const STATE_GLYPH: Record<SaveState, string> = { saving: '…', 'step-unapplied': '●', unsaved: '●', saved: '✓', unchanged: '' };

function pasteProblemText(problem: PasteProblem): string {
  if (problem.kind === 'too_long') return t('paste.tooLong', { line: problem.line, length: problem.length });
  if (problem.kind === 'invalid_characters') return t('paste.invalidCharacters', { line: problem.line });
  return t('paste.tooMany', { count: problem.fit });
}

/** Paste multiple steps: every non-empty line becomes a Step title — shown as a list before anything is added. */
function PasteDialog(props: { sectionTitle: string; room: number; onAdd: (titles: readonly string[]) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const preview = previewPastedSteps(text, props.room);
  return (
    <FormDialog
      title={t('paste.heading', { section: props.sectionTitle })}
      submitLabel={preview.titles.length === 0 ? t('paste.add') : t('paste.addCount', { count: preview.titles.length })}
      submitDisabled={preview.titles.length === 0 || preview.problems.length > 0}
      onClose={props.onClose}
      onSubmit={() => props.onAdd(preview.titles)}
    >
      <label>
        {t('paste.label')}
        <br />
        <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('paste.placeholder')} aria-describedby="paste-hint" />
      </label>
      <small id="paste-hint" className="muted">
        {t('paste.hint')}
      </small>
      {preview.problems.length > 0 && (
        <ul role="alert" className="problem-list">
          {preview.problems.map((problem) => (
            <li key={`${problem.kind}-${'line' in problem ? problem.line : 0}`}>{pasteProblemText(problem)}</li>
          ))}
        </ul>
      )}
      {preview.titles.length > 0 && (
        <div>
          <p className="section-label" id="paste-preview">
            {t('paste.preview', { count: preview.titles.length })}
          </p>
          <ol className="paste-preview" aria-labelledby="paste-preview">
            {preview.titles.map((title, index) => (
              <li key={index}>{title}</li>
            ))}
          </ol>
        </div>
      )}
    </FormDialog>
  );
}

/** Name and optional description of a Section (adding one, or changing it). */
function SectionDialog(props: { heading: string; submitLabel: string; initial: { title: string; description: string }; onSubmit: (value: { title: string; description: string }) => void; onClose: () => void }) {
  const [title, setTitle] = useState(props.initial.title);
  const [description, setDescription] = useState(props.initial.description);
  return (
    <FormDialog title={props.heading} submitLabel={props.submitLabel} onClose={props.onClose} onSubmit={() => props.onSubmit({ title: title.trim(), description })}>
      <label>
        {t('builder.sectionName')}
        <br />
        <input required maxLength={120} value={title} onFocus={(e) => e.target.select()} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        {t('builder.sectionDescription')} <span className="muted">{t('common.optional')}</span>
        <br />
        <textarea rows={2} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
    </FormDialog>
  );
}

/** Step rules at a glance: required or optional, critical, a photo. Words and marks — never colour alone. */
function StepChips({ step, problem }: { step: DraftStep; problem: string | undefined }) {
  return (
    <span className="step-chips">
      {problem !== undefined && (
        <span className="chip chip-problem">
          <span aria-hidden="true">!</span>
          {problem}
        </span>
      )}
      {step.critical && (
        <span className="chip chip-critical">
          <span aria-hidden="true">!</span>
          {t('builder.critical')}
        </span>
      )}
      <span className={step.required ? 'chip chip-required' : 'chip'}>{t(step.required ? 'builder.required' : 'mark.optional')}</span>
      {step.image != null && (
        <span className="chip chip-icon" role="img" aria-label={t('builder.hasImage')} title={t('builder.hasImage')}>
          <UiIcon name="photo" size="1.1em" />
        </span>
      )}
    </span>
  );
}

/** A compact look at how the open Section will read while executing (desktop side panel). */
function OutlinePreview({ section, onOpen }: { section: DraftSection | undefined; onOpen: () => void }) {
  return (
    <aside className="card side-preview" aria-label={t('builder.runPreview')}>
      <button type="button" className="side-preview-open" onClick={onOpen}>
        <UiIcon name="preview" /> {t('builder.runPreview')}
      </button>
      {section !== undefined && (
        <>
          <p className="side-preview-title">
            <strong>{section.title.trim() === '' ? t('builder.untitledSection') : section.title}</strong>
            <br />
            <small className="muted">{t('builder.stepCount', { count: section.steps.length })}</small>
          </p>
          <ol className="plain-list side-preview-steps">
            {section.steps.map((step, index) => (
              <li key={step.key}>
                <span className="step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span>{step.title.trim() === '' ? t('builder.untitledStep') : step.title}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

/**
 * The Procedure builder (15.2): outline first. Name it, type Step titles one after another, open only
 * the Steps that need instructions or rules, look at the preview, save. Not a wizard — everything is on
 * one screen and in any order.
 *
 * Nothing is stored until **Save procedure**: there is no autosave and no draft on the server. The
 * builder says which state it is in (unapplied Step changes, unsaved changes, saving, saved), asks
 * before leaving with unsaved changes, and saves against the revision it loaded — a newer version on
 * the server is never overwritten (the existing conflict answer is shown instead). Saving changes the
 * Procedure only; Runs already started keep their own snapshot.
 */
export function ProcedureBuilder(props: {
  workspaceId: string;
  /** `null`: a new Procedure. */
  procedureId: string | null;
  canStart: boolean;
  canSchedule: boolean;
  onOpenRun: (runId: string) => void;
}) {
  const { workspaceId } = props;
  const defaultSection = t('builder.defaultSection');
  /** A new Procedure starts empty, with one Section; an existing one is loaded from the server. */
  const [fresh] = useState<Draft | null>(() => (props.procedureId === null ? draftFrom(EMPTY, defaultSection) : null));
  const [justSaved] = useState(() => {
    const handed = handedOver<JustSaved>(JUST_SAVED);
    return handed !== undefined && handed.id === props.procedureId ? handed : null;
  });
  /** The Procedure on the server this draft belongs to (after loading or saving); `null` while it is new. */
  const [saved, setSaved] = useState<{ id: string; revision: number; title: string } | null>(null);
  const [baseline, setBaseline] = useState<Draft | null>(fresh);
  const [draft, setDraft] = useState<Draft | null>(fresh);
  const [openSection, setOpenSection] = useState<string | null>(fresh?.sections[0]?.key ?? null);
  const [editing, setEditing] = useState<string | null>(null);
  const editingRef = useRef<string | null>(null);
  const [stepDirty, setStepDirty] = useState(false);
  const stepDirtyRef = useRef(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewRef = useRef<HTMLDialogElement>(null);
  const [notice, setNotice] = useState<Undoable | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(justSaved !== null);
  const [imageUsage, setImageUsage] = useState<ImageUsage | null>(null);
  const [limitFor, setLimitFor] = useState<string | null>(null);
  /** The Step row that gets the focus back once the editor is closed (after the outline is shown again). */
  const focusRow = useRef<string | null>(null);
  // The ref is what drag handlers read (a fast drag fires dragover before React re-renders).
  const draggedRef = useRef<Dragged | null>(null);
  const [dragging, setDragging] = useState<Dragged['kind'] | null>(null);
  const titleId = useId();
  const tagsId = useId();
  const descriptionId = useId();
  const previewHeadingId = useId();
  const titleRef = useRef<HTMLInputElement>(null);

  /** Takes over the server's version (after loading or saving) as both the draft and what it is compared with. */
  const adopt = useCallback(
    (detail: ProcedureDetail, openIndex = 0) => {
      const next = draftFrom(detail, defaultSection);
      setSaved({ id: detail.id, revision: detail.revision, title: detail.title });
      setBaseline(next);
      setDraft(next);
      // A loaded Procedure has new client keys: the open Section is kept by its place.
      setOpenSection(next.sections[openIndex]?.key ?? next.sections[0]?.key ?? null);
      setNotice(null);
      setConflict(false);
      setShowProblems(false);
    },
    [defaultSection],
  );

  const load = useCallback(
    (id: string, openIndex = 0) => {
      api.procedure(workspaceId, id).then(
        (detail) => adopt(detail, openIndex),
        (caught: unknown) => setMessage(messageFor(caught)),
      );
    },
    [workspaceId, adopt],
  );
  useEffect(() => {
    if (props.procedureId !== null) load(props.procedureId, justSaved?.openIndex ?? 0);
    clearHandOver(JUST_SAVED);
  }, [props.procedureId, load, justSaved]);
  useEffect(() => {
    api.imageUsage(workspaceId).then(setImageUsage, () => setImageUsage(null));
  }, [workspaceId]);

  const dirty = draft !== null && baseline !== null && !sameContent(draft, baseline);
  const reportStepDirty = useCallback((value: boolean) => {
    stepDirtyRef.current = value;
    setStepDirty(value);
  }, []);

  // Leaving with unsaved or unapplied changes asks first: in-app navigation and Workspace switching
  // through the router's guard, closing or reloading the tab through the browser's own question.
  useEffect(() => {
    if (!dirty && !stepDirty) return;
    setNavigationGuard(() => window.confirm(t('builder.leaveConfirm')));
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty, stepDirty]);

  /** Closes the Step editor; `viaHistory`: Back already removed its history entry. */
  const closeEditor = useCallback((viaHistory = false) => {
    const key = editingRef.current;
    if (key === null) return;
    editingRef.current = null;
    stepDirtyRef.current = false;
    setEditing(null);
    setStepDirty(false);
    focusRow.current = key;
    if (!viaHistory && (window.history.state as Record<string, unknown> | null)?.[EDITOR_STATE] === true) window.history.back();
  }, []);
  // Back (the phone's button or gesture) leaves the Step editor for the outline instead of the builder.
  useEffect(() => {
    const onBack = () => {
      if (editingRef.current === null || (window.history.state as Record<string, unknown> | null)?.[EDITOR_STATE] === true) return;
      if (stepDirtyRef.current && !window.confirm(t('stepEditor.discardConfirm'))) {
        window.history.pushState({ [EDITOR_STATE]: true }, '', window.location.href);
        return;
      }
      closeEditor(true);
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, [closeEditor]);
  // After every render: once the editor is gone and the outline is back, its Step row takes the focus.
  useEffect(() => {
    if (focusRow.current === null || editingRef.current !== null) return;
    document.getElementById(stepRowId(focusRow.current))?.focus();
    focusRow.current = null;
  });
  useEffect(() => {
    const element = previewRef.current;
    if (previewing && element !== null && !element.open) element.showModal();
  }, [previewing]);

  if (draft === null) {
    return message !== null ? (
      <p role="alert">
        {message} <button type="button" className="link-like" onClick={() => navigate(paths.procedures(workspaceId))}>{t('builder.backToProcedures')}</button>
      </p>
    ) : (
      <p>{t('common.loading')}</p>
    );
  }

  const sections = draft.sections;
  const total = stepCount(draft);
  const problems: DraftProblems = draftProblems(draft);
  const shownProblems = showProblems ? problems : undefined;
  const state = saveState({ saving, stepDirty, dirty, savedOnce });
  const mayAddSection = sections.length < MAX_SECTIONS_PER_PROCEDURE;
  const open = sections.find((section) => section.key === openSection) ?? sections[0];
  const located = editing === null ? undefined : locateStep(sections, editing);
  const sectionName = (section: DraftSection) => (section.title.trim() === '' ? t('builder.untitledSection') : section.title);
  const stepName = (step: DraftStep) => (step.title.trim() === '' ? t('builder.untitledStep') : step.title);

  const setField = (patch: Partial<Pick<Draft, 'title' | 'description' | 'icon' | 'tags'>>) => setDraft({ ...draft, ...patch });
  /** Changes the outline; with `undoMessage` the change can be taken back (the outline as it was before). */
  const change = (next: readonly DraftSection[], undoMessage?: string) => {
    const before = sections;
    setDraft({ ...draft, sections: next });
    setLimitFor(null);
    setNotice(undoMessage === undefined ? null : { message: undoMessage, undo: () => setDraft((current) => (current === null ? current : { ...current, sections: before })) });
  };

  const openStep = (key: string) => {
    if (editingRef.current === key) return;
    if (editingRef.current !== null && stepDirtyRef.current && !window.confirm(t('stepEditor.discardConfirm'))) return;
    const alreadyOpen = editingRef.current !== null;
    editingRef.current = key;
    stepDirtyRef.current = false;
    setStepDirty(false);
    setEditing(key);
    if (!alreadyOpen) window.history.pushState({ [EDITOR_STATE]: true }, '', window.location.href);
  };
  const cancelStep = () => {
    if (stepDirtyRef.current && !window.confirm(t('stepEditor.discardConfirm'))) return;
    closeEditor();
  };

  const addStep = (section: DraftSection, title: string): boolean => {
    if (total >= MAX_STEPS_PER_PROCEDURE) {
      setLimitFor(section.key);
      return false;
    }
    change(addSteps(sections, section.key, [title]));
    return true;
  };

  const removeSectionAsked = (section: DraftSection) => {
    // A Section with Steps takes them along: ask first, and keep Undo at hand.
    if (section.steps.length > 0 && !window.confirm(t('builder.removeSectionConfirm', { title: sectionName(section), count: section.steps.length }))) return;
    if (located?.section.key === section.key) closeEditor();
    change(removeSection(sections, section.key), t('builder.sectionRemoved', { title: sectionName(section) }));
    if (openSection === section.key) setOpenSection(sections.find((other) => other.key !== section.key)?.key ?? null);
  };

  const stepMenu = (section: DraftSection, step: DraftStep, index: number): MoreMenuItem[] => [
    { label: t('builder.editStep'), onSelect: () => openStep(step.key) },
    ...(total < MAX_STEPS_PER_PROCEDURE ? [{ label: t('procedure.duplicate'), onSelect: () => change(duplicateStep(sections, step.key), t('builder.stepDuplicated', { title: stepName(step) })) }] : []),
    ...(index > 0 ? [{ label: t('builder.moveUp'), onSelect: () => change(moveStepBy(sections, step.key, -1), t('builder.stepMoved', { title: stepName(step) })) }] : []),
    ...(index < section.steps.length - 1 ? [{ label: t('builder.moveDown'), onSelect: () => change(moveStepBy(sections, step.key, 1), t('builder.stepMoved', { title: stepName(step) })) }] : []),
    ...(sections.length > 1 ? [{ label: t('builder.moveToSection'), onSelect: () => setDialog({ kind: 'move-step', key: step.key }) }] : []),
    {
      label: t('procedure.delete'),
      danger: true,
      onSelect: () => {
        if (editing === step.key) closeEditor();
        change(removeStep(sections, step.key), t('builder.stepDeleted', { title: stepName(step) }));
      },
    },
  ];
  const sectionMenu = (section: DraftSection, index: number): MoreMenuItem[] => [
    { label: t('builder.editSection'), onSelect: () => setDialog({ kind: 'edit-section', key: section.key }) },
    ...(index > 0 ? [{ label: t('builder.moveUp'), onSelect: () => change(moveSectionBy(sections, section.key, -1), t('builder.sectionMoved', { title: sectionName(section) })) }] : []),
    ...(index < sections.length - 1 ? [{ label: t('builder.moveDown'), onSelect: () => change(moveSectionBy(sections, section.key, 1), t('builder.sectionMoved', { title: sectionName(section) })) }] : []),
    ...(sections.length > 1 ? [{ label: t('builder.removeSection'), danger: true, onSelect: () => removeSectionAsked(section) }] : []),
  ];

  // ---- Drag and drop (desktop). The ⋯ menus hold the same moves for keyboard and touch. ----
  const drag = (item: Dragged) => ({
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = 'move';
      // Firefox only starts a drag with data set; the value itself is not used.
      event.dataTransfer.setData('text/plain', '');
      draggedRef.current = item;
      setDragging(item.kind);
    },
    onDragEnd: () => {
      draggedRef.current = null;
      setDragging(null);
    },
  });
  const drop = (accepts: readonly Dragged['kind'][], perform: (item: Dragged) => void) => ({
    onDragOver: (event: DragEvent) => {
      const item = draggedRef.current;
      if (item === null || !accepts.includes(item.kind)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
    },
    onDrop: (event: DragEvent) => {
      const item = draggedRef.current;
      if (item === null || !accepts.includes(item.kind)) return;
      event.preventDefault();
      event.stopPropagation();
      perform(item);
      draggedRef.current = null;
      setDragging(null);
    },
  });
  const dropStepAt = (section: DraftSection, index: number) => (item: Dragged) => {
    const moved = locateStep(sections, item.key)?.step;
    if (moved !== undefined) change(moveStepTo(sections, item.key, section.key, index), t('builder.stepMoved', { title: stepName(moved) }));
  };
  const dropOnSection = (section: DraftSection, index: number) => (item: Dragged) => {
    if (item.kind === 'step') return dropStepAt(section, Number.MAX_SAFE_INTEGER)(item);
    const moved = sections.find((other) => other.key === item.key);
    if (moved !== undefined) change(moveSectionTo(sections, item.key, index), t('builder.sectionMoved', { title: sectionName(moved) }));
  };

  async function save() {
    if (!canSave({ saving, stepDirty, dirty, isNew: saved === null })) return;
    setMessage(null);
    if (hasProblems(problems)) {
      // Nothing is sent and nothing is lost: the fields say what is missing.
      setShowProblems(true);
      setMessage(t('builder.fixFirst'));
      const firstSection = sections.find((section) => problems.sections[section.key] !== undefined || section.steps.some((step) => problems.steps[step.key] !== undefined));
      if (problems.title !== undefined) titleRef.current?.focus();
      else if (firstSection !== undefined) setOpenSection(firstSection.key);
      return;
    }
    setSaving(true);
    try {
      const content = toContent(draft as Draft);
      const detail = saved === null ? await api.createProcedure(workspaceId, content) : await api.updateProcedure(workspaceId, saved.id, saved.revision, content);
      const openIndex = Math.max(0, sections.findIndex((section) => section.key === openSection));
      if (editingRef.current !== null) closeEditor();
      adopt(detail, openIndex);
      setSavedOnce(true);
      if (props.procedureId === null) {
        // From now on this is an existing Procedure with its own address (reload and Back keep working).
        handOver(JUST_SAVED, { id: detail.id, openIndex } satisfies JustSaved);
        navigate(paths.editProcedure(workspaceId, detail.id), { replace: true, force: true });
      }
    } catch (caught) {
      setConflict(caught instanceof ApiError && caught.code === 'procedure_conflict');
      setMessage(messageFor(caught));
    } finally {
      setSaving(false);
    }
  }

  const stateText: Record<SaveState, string> = {
    saving: t('builder.state.saving'),
    'step-unapplied': t('builder.state.stepUnapplied'),
    unsaved: t('builder.state.unsaved'),
    saved: t('builder.state.saved'),
    unchanged: saved === null ? t('builder.state.new') : t('builder.state.unchanged'),
  };
  const saveBlocked = stepDirty;
  const mayNotSave = !canSave({ saving, stepDirty, dirty, isNew: saved === null });
  const back = saved === null ? { href: paths.procedures(workspaceId), label: t('builder.backToProcedures') } : { href: paths.procedure(workspaceId, saved.id), label: t('builder.backToProcedure') };

  return (
    <div className="builder" data-editing={located !== undefined}>
      {/* The global header is hidden while editing: the builder provides the page's level-one heading. */}
      <h1 className="visually-hidden">{t(saved === null ? 'builder.headingNew' : 'builder.headingEdit')}</h1>
      <div className="builder-bar">
        <button type="button" className="quiet" onClick={() => navigate(back.href)}>
          <UiIcon name="back" /> {back.label}
        </button>
      </div>
      <div className="builder-actions">
        <span className="builder-state" role="status" data-state={state}>
          {STATE_GLYPH[state] !== '' && <span aria-hidden="true">{STATE_GLYPH[state]} </span>}
          {stateText[state]}
        </span>
        <div className="builder-buttons">
          {saved !== null && !dirty && !stepDirty && (
            <StartControl workspaceId={workspaceId} procedure={{ id: saved.id, title: saved.title }} canStart={props.canStart} canSchedule={props.canSchedule} onOpenRun={props.onOpenRun} />
          )}
          <button type="button" onClick={() => setPreviewing(true)}>
            <UiIcon name="preview" /> {t('builder.preview')}
          </button>
          {/* Never saves an outline older than what the Step editor shows: apply or cancel the Step first. */}
          <button type="button" className="primary" aria-disabled={mayNotSave} aria-describedby={saveBlocked ? 'save-blocked' : undefined} disabled={saving} onClick={() => void save()}>
            <UiIcon name="save" /> {t('builder.save')}
          </button>
        </div>
        {saveBlocked && (
          <small id="save-blocked" className="muted builder-blocked">
            {t('builder.applyFirst')}
          </small>
        )}
      </div>

      <div className="builder-main">
        {message !== null && (
          <div role="alert">
            {message}
            {conflict && saved !== null && (
              <>
                {' '}
                <button
                  type="button"
                  className="link-like"
                  onClick={() => {
                    if (window.confirm(t('builder.reloadConfirm'))) {
                      setMessage(null);
                      setSavedOnce(false);
                      load(saved.id);
                    }
                  }}
                >
                  {t('builder.reload')}
                </button>
              </>
            )}
          </div>
        )}
        <div className="builder-head">
          <div className="builder-name">
            <span className="item-icon">
              <AppIcon name={draft.icon} decorative />
            </span>
            <div className="field">
              <label htmlFor={titleId} className="visually-hidden">
                {t('builder.name')}
              </label>
              <input
                ref={titleRef}
                id={titleId}
                className="builder-title"
                maxLength={120}
                placeholder={t('builder.namePlaceholder')}
                value={draft.title}
                aria-invalid={shownProblems?.title !== undefined}
                aria-describedby={shownProblems?.title === undefined ? undefined : `${titleId}-error`}
                onChange={(e) => setField({ title: e.target.value })}
              />
              {shownProblems?.title !== undefined && (
                <span id={`${titleId}-error`} className="field-error">
                  {t(`error.${shownProblems.title}`)}
                </span>
              )}
            </div>
          </div>
          <details className="option-group builder-details">
            <summary>
              <span className="option-label">{t('builder.details')}</span>
              <span className="muted option-value">{t('builder.detailsHint')}</span>
            </summary>
            <div className="stack option-body">
              <div className="field">
                <label htmlFor={descriptionId}>{t('form.description')}</label>
                <textarea id={descriptionId} rows={3} maxLength={4000} value={draft.description} onChange={(e) => setField({ description: e.target.value })} />
              </div>
              <IconPicker label={t('form.icon')} value={draft.icon} allowNone={false} onChange={(next: ProcedureIcon | null) => setField({ icon: next ?? 'checklist' })} />
              <div className="field">
                <label htmlFor={tagsId}>{t('form.tags')}</label>
                <input id={tagsId} value={draft.tags} onChange={(e) => setField({ tags: e.target.value })} />
              </div>
            </div>
          </details>
        </div>

        <div className="builder-columns">
          {/* Desktop: the Sections as a rail — choose one, drag to reorder, drop a Step on one to move it there. */}
          <nav className="builder-rail" aria-label={t('builder.sections')}>
            <ul className="plain-list">
              {sections.map((section, index) => (
                <li key={section.key} {...drop(['section', 'step'], dropOnSection(section, index))}>
                  <button
                    type="button"
                    className="rail-section"
                    aria-current={open?.key === section.key ? 'true' : undefined}
                    title={t('builder.dragSection', { title: sectionName(section) })}
                    {...drag({ kind: 'section', key: section.key })}
                    onClick={() => setOpenSection(section.key)}
                  >
                    <span className="rail-text">
                      <strong>{sectionName(section)}</strong>
                      <small className="muted">{t('builder.stepCount', { count: section.steps.length })}</small>
                    </span>
                    <UiIcon name="chevron" />
                  </button>
                </li>
              ))}
            </ul>
            {mayAddSection && (
              <button type="button" className="builder-add-section" onClick={() => setDialog({ kind: 'add-section' })}>
                <UiIcon name="add" /> {t('builder.addSection')}
              </button>
            )}
          </nav>

          <div className="builder-outline">
            {shownProblems !== undefined && (shownProblems.tooManySections || shownProblems.tooManySteps) && (
              <p role="alert">{t(shownProblems.tooManySteps ? 'error.too_many_steps' : 'error.too_many_sections')}</p>
            )}
            {sections.map((section, sectionIndex) => {
              const isOpen = open?.key === section.key;
              const headingId = `section-${section.key}`;
              const sectionProblem = shownProblems?.sections[section.key];
              return (
                <section key={section.key} className="card outline-section" data-open={isOpen} aria-labelledby={headingId}>
                  <div className="outline-section-head">
                    <h2 id={headingId}>
                      <button type="button" className="section-toggle" aria-expanded={isOpen} onClick={() => setOpenSection(section.key)}>
                        <span>{sectionName(section)}</span>
                        <small className="muted">{t('builder.stepCount', { count: section.steps.length })}</small>
                      </button>
                    </h2>
                    {!isOpen && <UiIcon name="chevron" />}
                    {isOpen && <MoreMenu label={t('builder.moreForSection', { title: sectionName(section) })} items={sectionMenu(section, sectionIndex)} />}
                  </div>
                  {sectionProblem !== undefined && <p className="field-error">{t(`error.${sectionProblem}`)}</p>}
                  {isOpen && (
                    <>
                      {section.description !== '' && <p className="muted outline-description">{section.description}</p>}
                      <ol className="plain-list outline-steps" aria-labelledby={headingId}>
                        {section.steps.map((step, index) => {
                          const problem = shownProblems?.steps[step.key];
                          return (
                            <li key={step.key} className="outline-step" data-current={editing === step.key} {...drop(['step'], dropStepAt(section, index))}>
                              <span className="drag-handle" title={t('builder.dragStep', { number: index + 1 })} aria-hidden="true" {...drag({ kind: 'step', key: step.key })}>
                                <UiIcon name="grip" />
                              </span>
                              <span className="step-number" aria-hidden="true">
                                {index + 1}
                              </span>
                              <button
                                type="button"
                                id={stepRowId(step.key)}
                                className="step-open"
                                aria-label={t('builder.openStep', { number: index + 1, title: stepName(step) })}
                                aria-current={editing === step.key ? 'true' : undefined}
                                onClick={() => openStep(step.key)}
                              >
                                {step.icon !== null && <AppIcon name={step.icon} decorative />} {stepName(step)}
                              </button>
                              <StepChips step={step} problem={problem === undefined ? undefined : t(`builder.problem.${problem}`)} />
                              <MoreMenu label={t('builder.moreForStep', { number: index + 1, title: stepName(step) })} items={stepMenu(section, step, index)} />
                            </li>
                          );
                        })}
                      </ol>
                      {dragging === 'step' && (
                        <p className="drop-zone" {...drop(['step'], dropStepAt(section, Number.MAX_SAFE_INTEGER))}>
                          {t('builder.dropHere', { title: sectionName(section) })}
                        </p>
                      )}
                      <AddStep
                        sectionTitle={sectionName(section)}
                        empty={section.steps.length === 0}
                        limitReached={limitFor === section.key}
                        onAdd={(title) => addStep(section, title)}
                        onPaste={() => setDialog({ kind: 'paste', key: section.key })}
                      />
                    </>
                  )}
                </section>
              );
            })}
            {mayAddSection && (
              <button type="button" className="builder-add-section builder-add-section-phone" onClick={() => setDialog({ kind: 'add-section' })}>
                <UiIcon name="add" /> {t('builder.addSection')}
              </button>
            )}
            <UndoNotice notice={notice} onDismiss={() => setNotice(null)} />
          </div>

          <div className="builder-side">
            {located !== undefined ? (
              <StepEditor
                key={located.step.key}
                workspaceId={workspaceId}
                step={located.step}
                number={sections.length > 1 ? `${located.sectionIndex + 1}.${located.index + 1}` : String(located.index + 1)}
                sectionKey={located.section.key}
                sections={sections.map((section) => ({ key: section.key, title: section.title }))}
                imageUsage={imageUsage}
                onImageUsage={setImageUsage}
                onDirty={reportStepDirty}
                onCancel={cancelStep}
                onApply={(step, sectionKey) => {
                  change(applyStep(sections, step, sectionKey));
                  setOpenSection(sectionKey);
                  closeEditor();
                }}
              />
            ) : (
              <OutlinePreview section={open} onOpen={() => setPreviewing(true)} />
            )}
          </div>
        </div>
      </div>

      {previewing && (
        <dialog ref={previewRef} className="dialog preview-dialog" aria-labelledby={previewHeadingId} onClose={() => setPreviewing(false)}>
          <div className="preview-head">
            <div>
              <h2 id={previewHeadingId}>{t('builder.preview')}</h2>
              <p className="muted">{t('preview.note')}</p>
              {stepDirty && located !== undefined && <p role="note">{t('preview.unapplied', { title: stepName(located.step) })}</p>}
            </div>
            <button type="button" className="primary" onClick={() => previewRef.current?.close()}>
              {t('preview.close')}
            </button>
          </div>
          <ProcedurePreview content={toContent(draft)} workspaceId={workspaceId} />
        </dialog>
      )}
      {dialog?.kind === 'paste' && open !== undefined && (
        <PasteDialog
          sectionTitle={sectionName(sections.find((section) => section.key === dialog.key) ?? open)}
          room={MAX_STEPS_PER_PROCEDURE - total}
          onClose={() => setDialog(null)}
          onAdd={(titles) => change(addSteps(sections, dialog.key, titles), t('builder.stepsAdded', { count: titles.length }))}
        />
      )}
      {dialog?.kind === 'add-section' && (
        <SectionDialog
          heading={t('builder.addSection')}
          submitLabel={t('builder.addSection')}
          initial={{ title: t('builder.newSectionTitle', { number: sections.length + 1 }), description: '' }}
          onClose={() => setDialog(null)}
          onSubmit={(value) => {
            const added = { ...newSection(value.title), description: value.description };
            change([...sections, added]);
            setOpenSection(added.key);
          }}
        />
      )}
      {dialog?.kind === 'edit-section' &&
        (() => {
          const section = sections.find((candidate) => candidate.key === dialog.key);
          return section === undefined ? null : (
            <SectionDialog
              heading={t('builder.editSectionHeading', { title: sectionName(section) })}
              submitLabel={t('builder.applySection')}
              initial={{ title: section.title, description: section.description }}
              onClose={() => setDialog(null)}
              onSubmit={(value) => change(updateSection(sections, section.key, value))}
            />
          );
        })()}
      {dialog?.kind === 'move-step' &&
        (() => {
          const found = locateStep(sections, dialog.key);
          return found === undefined ? null : (
            <MoveStepDialog
              stepTitle={stepName(found.step)}
              sections={sections.filter((section) => section.key !== found.section.key).map((section) => ({ key: section.key, title: sectionName(section) }))}
              onClose={() => setDialog(null)}
              onMove={(sectionKey) => {
                change(moveStepTo(sections, found.step.key, sectionKey, Number.MAX_SAFE_INTEGER), t('builder.stepMoved', { title: stepName(found.step) }));
                setOpenSection(sectionKey);
              }}
            />
          );
        })()}
    </div>
  );
}

/** The inline "Add a step…" field: Enter adds the Step and the field is ready for the next one. */
function AddStep(props: { sectionTitle: string; empty: boolean; limitReached: boolean; onAdd: (title: string) => boolean; onPaste: () => void }) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (value !== '' && props.onAdd(value)) setTitle('');
    // Also after a click on Add: back to the field, ready for the next Step.
    inputRef.current?.focus();
  }
  return (
    <div className="add-step">
      {props.empty && <p className="muted">{t('builder.noSteps')}</p>}
      <div className="add-step-row">
        <form onSubmit={submit} className="add-step-form">
          <label htmlFor={id} className="visually-hidden">
            {t('builder.addStepTo', { title: props.sectionTitle })}
          </label>
          <input
            ref={inputRef}
            id={id}
            maxLength={200}
            value={title}
            placeholder={t('builder.addStepPlaceholder')}
            enterKeyHint="done"
            aria-describedby={props.limitReached ? `${id}-limit ${id}-hint` : `${id}-hint`}
            aria-invalid={props.limitReached}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit" className="primary">
            {t('builder.add')}
          </button>
        </form>
        <button type="button" onClick={props.onPaste}>
          <UiIcon name="paste" /> {t('builder.pasteSteps')}
        </button>
      </div>
      {props.limitReached && (
        <span id={`${id}-limit`} className="field-error" role="alert">
          {t('error.too_many_steps')}
        </span>
      )}
      <small id={`${id}-hint`} className="muted">
        {t('builder.addStepHint')}
      </small>
    </div>
  );
}

/** The keyboard and touch way to move a Step to another Section (dragging it onto a Section does the same). */
function MoveStepDialog(props: { stepTitle: string; sections: readonly { key: string; title: string }[]; onMove: (sectionKey: string) => void; onClose: () => void }) {
  const [target, setTarget] = useState(props.sections[0]?.key ?? '');
  const id = useId();
  return (
    <FormDialog title={t('builder.moveStepHeading', { title: props.stepTitle })} submitLabel={t('builder.move')} onClose={props.onClose} onSubmit={() => props.onMove(target)}>
      <div className="field">
        <label htmlFor={id}>{t('stepEditor.section')}</label>
        <select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
          {props.sections.map((section) => (
            <option key={section.key} value={section.key}>
              {section.title}
            </option>
          ))}
        </select>
      </div>
    </FormDialog>
  );
}
