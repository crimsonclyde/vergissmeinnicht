import { useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  messageFor,
  PROCEDURE_ICONS,
  REASON_POLICIES,
  type ProcedureContent,
  type ProcedureIcon,
  type ReasonPolicy,
  type SectionInput,
  type StepInput,
} from './api.ts';
import { ICONS } from './procedure-icons.tsx';
import { moveItem, moveStep, type StepPosition } from './structure-moves.ts';

const POLICY_LABELS: Record<ReasonPolicy, string> = {
  DISABLED: 'No reason',
  OPTIONAL: 'Reason optional',
  REQUIRED: 'Reason required',
};

// Client-only keys keep React state attached to the right row while items move.
type Keyed<T> = T & { readonly key: number };
type DraftStep = Keyed<StepInput>;
type DraftSection = Keyed<Omit<SectionInput, 'steps'> & { readonly steps: readonly DraftStep[] }>;

let nextKey = 0;
const keyed = <T,>(item: T): Keyed<T> => ({ ...item, key: nextKey++ });

/** Back to API input: client-only keys dropped, ids of existing items kept. */
function toStepInput(step: DraftStep): StepInput {
  return {
    ...(step.id === undefined ? {} : { id: step.id }),
    title: step.title,
    description: step.description,
    icon: step.icon,
    required: step.required,
    critical: step.critical,
    skipReasonPolicy: step.skipReasonPolicy,
    notApplicableReasonPolicy: step.notApplicableReasonPolicy,
  };
}

function toSectionInput(section: DraftSection): SectionInput {
  return {
    ...(section.id === undefined ? {} : { id: section.id }),
    title: section.title,
    description: section.description,
    steps: section.steps.map(toStepInput),
  };
}

const NEW_STEP: StepInput = {
  title: '',
  description: '',
  icon: null,
  required: true,
  critical: false,
  skipReasonPolicy: 'OPTIONAL',
  notApplicableReasonPolicy: 'OPTIONAL',
};

type Dragged = { readonly kind: 'section'; readonly index: number } | { readonly kind: 'step'; readonly from: StepPosition };

/** Native drag and drop (desktop). ↑/↓ buttons and "Move to section" are the keyboard/touch alternative. */
interface DragBindings {
  readonly handle: {
    draggable: true;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
  };
  readonly target: {
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
}

function DragHandle(props: DragBindings['handle'] & { label: string }) {
  const { label, ...handle } = props;
  return (
    <span {...handle} title={label} aria-hidden="true" style={{ cursor: 'grab', userSelect: 'none' }}>
      ⠿
    </span>
  );
}

function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

// Explicit label association: a label wrapping a <select> would add the selected option to its name.
function IconSelect(props: { label: string; value: ProcedureIcon | null; allowNone: boolean; onChange: (icon: ProcedureIcon | null) => void }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{props.label}</label>{' '}
      <select
        id={id}
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value === '' ? null : (e.target.value as ProcedureIcon))}
      >
        {props.allowNone && <option value="">No icon</option>}
        {PROCEDURE_ICONS.map((key) => (
          <option key={key} value={key}>
            {ICONS[key].glyph} {ICONS[key].label}
          </option>
        ))}
      </select>
    </>
  );
}

function PolicySelect(props: { label: string; value: ReasonPolicy; onChange: (policy: ReasonPolicy) => void }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{props.label}</label>{' '}
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value as ReasonPolicy)}>
        {REASON_POLICIES.map((policy) => (
          <option key={policy} value={policy}>
            {POLICY_LABELS[policy]}
          </option>
        ))}
      </select>
    </>
  );
}

function StepEditor(props: {
  step: DraftStep;
  number: string;
  isFirst: boolean;
  isLast: boolean;
  sectionNumber: number;
  sectionTitles: readonly string[];
  drag: DragBindings;
  onChange: (step: DraftStep) => void;
  onMove: (delta: -1 | 1) => void;
  onMoveToSection: (sectionIndex: number) => void;
  onRemove: () => void;
}) {
  const { step, number } = props;
  const set = (patch: Partial<StepInput>) => props.onChange({ ...step, ...patch });
  const moveId = useId();
  return (
    <fieldset {...props.drag.target}>
      <legend>
        <DragHandle {...props.drag.handle} label={`Drag step ${number}`} /> Step {number}
      </legend>
      <p>
        <label>
          Step {number} title
          <br />
          <input required maxLength={200} value={step.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
      </p>
      <p>
        <label>
          Step {number} description
          <br />
          <textarea rows={2} maxLength={4000} value={step.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
      </p>
      <p>
        <IconSelect label={`Step ${number} icon`} value={step.icon} allowNone onChange={(icon) => set({ icon })} />{' '}
        <label>
          <input type="checkbox" checked={step.required} onChange={(e) => set({ required: e.target.checked })} /> Required
        </label>{' '}
        <label>
          <input type="checkbox" checked={step.critical} onChange={(e) => set({ critical: e.target.checked })} /> Critical
          (press and hold to confirm)
        </label>
      </p>
      <p>
        <PolicySelect label="When skipped:" value={step.skipReasonPolicy} onChange={(skipReasonPolicy) => set({ skipReasonPolicy })} />{' '}
        <PolicySelect
          label="When not applicable:"
          value={step.notApplicableReasonPolicy}
          onChange={(notApplicableReasonPolicy) => set({ notApplicableReasonPolicy })}
        />
      </p>
      <p>
        <button type="button" disabled={props.isFirst} onClick={() => props.onMove(-1)} aria-label={`Move step ${number} up`}>
          ↑
        </button>{' '}
        <button type="button" disabled={props.isLast} onClick={() => props.onMove(1)} aria-label={`Move step ${number} down`}>
          ↓
        </button>{' '}
        <label htmlFor={moveId}>Move step {number} to section</label>{' '}
        <select
          id={moveId}
          value={props.sectionNumber - 1}
          onChange={(e) => props.onMoveToSection(Number(e.target.value))}
        >
          {props.sectionTitles.map((title, i) => (
            <option key={i} value={i}>
              {i + 1}. {title === '' ? '(untitled)' : title}
            </option>
          ))}
        </select>{' '}
        <button type="button" onClick={props.onRemove}>
          Remove step {number}
        </button>
      </p>
    </fieldset>
  );
}

/** Edits a complete Procedure (content, Sections, Steps); one submit is one save on the server. */
export function ProcedureForm(props: {
  initial: ProcedureContent;
  submitLabel: string;
  onSubmit: (content: ProcedureContent) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(props.initial.title);
  const [description, setDescription] = useState(props.initial.description);
  const [icon, setIcon] = useState<ProcedureIcon>(props.initial.icon);
  const [tags, setTags] = useState(props.initial.tags.join(', '));
  const [sections, setSections] = useState<DraftSection[]>(() =>
    props.initial.sections.map((section) => keyed({ ...section, steps: section.steps.map((step) => keyed(step)) })),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The ref is what event handlers read (a fast drag fires dragover before React re-renders);
  // the state only drives rendering of the drop zones.
  const draggedRef = useRef<Dragged | null>(null);
  const [dragged, setDraggedState] = useState<Dragged | null>(null);
  const setDragged = (item: Dragged | null) => {
    draggedRef.current = item;
    setDraggedState(item);
  };

  const handle = (item: Dragged): DragBindings['handle'] => ({
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = 'move';
      // Firefox only starts a drag with data set; the value itself is not used.
      event.dataTransfer.setData('text/plain', '');
      setDragged(item);
    },
    onDragEnd: () => setDragged(null),
  });
  /** A drop target that accepts `accepts` drags and performs `drop` with the dragged item. */
  const target = (accepts: Dragged['kind'], drop: (item: Dragged) => void): DragBindings['target'] => ({
    onDragOver: (event) => {
      if (draggedRef.current?.kind !== accepts) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
    },
    onDrop: (event) => {
      const item = draggedRef.current;
      if (item?.kind !== accepts) return;
      event.preventDefault();
      event.stopPropagation();
      drop(item);
      setDragged(null);
    },
  });
  const moveStepTo = (from: StepPosition, to: StepPosition) => setSections((current) => moveStep(current, from, to));

  const updateSection = (index: number, patch: Partial<DraftSection>) =>
    setSections((current) => current.map((section, i) => (i === index ? { ...section, ...patch } : section)));
  const updateSteps = (index: number, change: (steps: readonly DraftStep[]) => DraftStep[]) =>
    setSections((current) => current.map((section, i) => (i === index ? { ...section, steps: change(section.steps) } : section)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await props.onSubmit({
        title,
        description,
        icon,
        tags: splitTags(tags),
        sections: sections.map(toSectionInput),
      });
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {message !== null && <p role="alert">{message}</p>}
      <p>
        <label>
          Title
          <br />
          <input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          Description
          <br />
          <textarea rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </p>
      <p>
        <IconSelect label="Icon" value={icon} allowNone={false} onChange={(next) => setIcon(next ?? 'checklist')} />
      </p>
      <p>
        <label>
          Tags (comma-separated)
          <br />
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
      </p>

      {sections.map((section, index) => (
        <fieldset
          key={section.key}
          {...target('section', (item) => item.kind === 'section' && setSections((current) => moveItem(current, item.index, index)))}
        >
          <legend>
            <DragHandle {...handle({ kind: 'section', index })} label={`Drag section ${index + 1}`} /> Section {index + 1}
          </legend>
          <p>
            <label>
              Section {index + 1} title
              <br />
              <input required maxLength={120} value={section.title} onChange={(e) => updateSection(index, { title: e.target.value })} />
            </label>
          </p>
          <p>
            <label>
              Section {index + 1} description
              <br />
              <textarea
                rows={2}
                maxLength={4000}
                value={section.description}
                onChange={(e) => updateSection(index, { description: e.target.value })}
              />
            </label>
          </p>
          {section.steps.map((step, stepIndex) => (
            <StepEditor
              key={step.key}
              step={step}
              number={`${index + 1}.${stepIndex + 1}`}
              isFirst={stepIndex === 0}
              isLast={stepIndex === section.steps.length - 1}
              sectionNumber={index + 1}
              sectionTitles={sections.map((s) => s.title)}
              drag={{
                handle: handle({ kind: 'step', from: { section: index, index: stepIndex } }),
                target: target('step', (item) => item.kind === 'step' && moveStepTo(item.from, { section: index, index: stepIndex })),
              }}
              onChange={(next) => updateSteps(index, (steps) => steps.map((s, i) => (i === stepIndex ? next : s)))}
              onMove={(delta) => updateSteps(index, (steps) => moveItem(steps, stepIndex, stepIndex + delta))}
              onMoveToSection={(sectionIndex) =>
                moveStepTo(
                  { section: index, index: stepIndex },
                  {
                    section: sectionIndex,
                    index: (sections[sectionIndex]?.steps.length ?? 0) - (sectionIndex === index ? 1 : 0),
                  },
                )
              }
              onRemove={() => updateSteps(index, (steps) => steps.filter((_, i) => i !== stepIndex))}
            />
          ))}
          {dragged?.kind === 'step' && (
            <p
              {...target('step', (item) =>
                item.kind === 'step' &&
                moveStepTo(item.from, {
                  section: index,
                  index: section.steps.length - (item.from.section === index ? 1 : 0),
                }),
              )}
              style={{ border: '1px dashed', padding: '0.5em' }}
            >
              Drop here to move the step to the end of section {index + 1}
            </p>
          )}
          <p>
            <button type="button" onClick={() => updateSteps(index, (steps) => [...steps, keyed(NEW_STEP)])}>
              Add step to section {index + 1}
            </button>{' '}
            <button
              type="button"
              disabled={index === 0}
              aria-label={`Move section ${index + 1} up`}
              onClick={() => setSections((current) => moveItem(current, index, index - 1))}
            >
              ↑
            </button>{' '}
            <button
              type="button"
              disabled={index === sections.length - 1}
              aria-label={`Move section ${index + 1} down`}
              onClick={() => setSections((current) => moveItem(current, index, index + 1))}
            >
              ↓
            </button>{' '}
            <button type="button" onClick={() => setSections((current) => current.filter((_, i) => i !== index))}>
              Remove section {index + 1}
            </button>
          </p>
        </fieldset>
      ))}
      <p>
        <button type="button" onClick={() => setSections((current) => [...current, keyed({ title: '', description: '', steps: [] })])}>
          Add section
        </button>
      </p>

      <button type="submit" disabled={busy}>
        {props.submitLabel}
      </button>{' '}
      <button type="button" onClick={props.onCancel}>
        Cancel
      </button>
    </form>
  );
}
