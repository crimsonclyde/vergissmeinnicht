import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { REASON_POLICIES, type ImageUsage, type ReasonPolicy } from './api.ts';
import { IconPicker } from './IconPicker.tsx';
import { t } from './i18n/index.ts';
import { stepProblems, type DraftStep } from './procedure-draft.ts';
import { formatBytes } from './document-model.ts';
import { StepImageField } from './StepImage.tsx';
import { UiIcon } from './ui-icons.tsx';

function PolicySelect(props: { label: string; value: ReasonPolicy; onChange: (policy: ReasonPolicy) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value as ReasonPolicy)}>
        {REASON_POLICIES.map((policy) => (
          <option key={policy} value={policy}>
            {t(`policy.${policy}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A switch with its explanation: the label names the rule, the text says what it means while executing. */
function RuleSwitch(props: { label: string; explanation: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="rule">
      <div className="rule-text">
        <label htmlFor={id}>{props.label}</label>
        <small id={`${id}-hint`} className="muted">
          {props.explanation}
        </small>
      </div>
      <input id={id} type="checkbox" role="switch" className="switch" checked={props.checked} aria-describedby={`${id}-hint`} onChange={(e) => props.onChange(e.target.checked)} />
    </div>
  );
}

/** What is compared to tell whether the editor holds unapplied changes. */
const fingerprint = (step: DraftStep, sectionKey: string): string => JSON.stringify([sectionKey, step.title, step.description, step.icon, step.required, step.critical, step.skipReasonPolicy, step.notApplicableReasonPolicy, step.image ?? null]);

/**
 * The focused Step editor (15.2): a side panel next to the outline on desktop, the whole screen on a
 * phone. It works on its own copy of the Step. **Apply step** puts that copy into the Procedure's
 * unsaved outline and returns to it; **Cancel** drops only what was not applied. Nothing here reaches
 * the server except a chosen photo (stored at once, referenced only when the Procedure is saved).
 * The rules are the existing ones — required, critical, skip and not-applicable reasons — unchanged.
 */
export function StepEditor(props: {
  workspaceId: string;
  step: DraftStep;
  /** "2" or "1.2": how the Step is numbered in the outline. */
  number: string;
  sectionKey: string;
  sections: readonly { readonly key: string; readonly title: string }[];
  imageUsage: ImageUsage | null;
  onImageUsage: (usage: ImageUsage) => void;
  onApply: (step: DraftStep, sectionKey: string) => void;
  /** Close without applying (the caller asks before discarding changes). */
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { onDirty } = props;
  const [local, setLocal] = useState<DraftStep>(props.step);
  const [sectionKey, setSectionKey] = useState(props.sectionKey);
  const [showProblems, setShowProblems] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const titleId = useId();
  const sectionId = useId();
  const descriptionId = useId();
  const set = (patch: Partial<DraftStep>) => setLocal((current) => ({ ...current, ...patch }));

  const dirty = fingerprint(local, sectionKey) !== fingerprint(props.step, props.sectionKey);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  // The editor is where the attention goes: its first field takes the focus.
  useEffect(() => titleRef.current?.focus(), []);

  const problems = stepProblems(local);
  const shown = showProblems ? problems : {};

  function apply(event: FormEvent) {
    event.preventDefault();
    if (problems.title !== undefined || problems.caption !== undefined) {
      setShowProblems(true);
      if (problems.title !== undefined) titleRef.current?.focus();
      return;
    }
    props.onApply({ ...local, title: local.title.trim(), image: local.image == null ? null : { ...local.image, caption: local.image.caption.trim() } }, sectionKey);
  }

  return (
    <form className="step-editor" aria-labelledby={headingId} noValidate onSubmit={apply}>
      <div className="step-editor-head">
        <button type="button" className="quiet icon-button" aria-label={t('stepEditor.close')} onClick={props.onCancel}>
          <span className="only-phone">
            <UiIcon name="back" />
          </span>
          <span className="only-desktop">
            <UiIcon name="close" />
          </span>
        </button>
        <h2 id={headingId}>{t('stepEditor.heading')}</h2>
      </div>
      <div className="step-editor-body">
        {props.sections.length > 1 && (
          <div className="field">
            <label htmlFor={sectionId}>{t('stepEditor.section')}</label>
            <select id={sectionId} value={sectionKey} onChange={(e) => setSectionKey(e.target.value)}>
              {props.sections.map((section) => (
                <option key={section.key} value={section.key}>
                  {section.title.trim() === '' ? t('builder.untitledSection') : section.title}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor={titleId}>{t('stepEditor.title')}</label>
          <input
            ref={titleRef}
            id={titleId}
            maxLength={200}
            value={local.title}
            aria-invalid={shown.title !== undefined}
            aria-describedby={shown.title === undefined ? undefined : `${titleId}-error`}
            onChange={(e) => set({ title: e.target.value })}
          />
          {shown.title !== undefined && (
            <span id={`${titleId}-error`} className="field-error">
              {t(`error.${shown.title}`)}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor={descriptionId}>
            {t('stepEditor.instructions')} <span className="muted">{t('common.optional')}</span>
          </label>
          <textarea id={descriptionId} rows={3} maxLength={4000} value={local.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div className="field">
          <IconPicker label={t('stepEditor.icon')} value={local.icon} allowNone onChange={(icon) => set({ icon })} />
        </div>
        <div className="field">
          <span className="field-label">{t('stepEditor.image')}</span>
          <StepImageField
            workspaceId={props.workspaceId}
            number={props.number}
            image={local.image ?? null}
            onChange={(image) => set({ image })}
            onUsage={props.onImageUsage}
            captionError={shown.caption === undefined ? undefined : t(`error.${shown.caption}`)}
          />
          <small className="muted">
            {t('stepEditor.imageHint')}
            {props.imageUsage !== null && ` ${t('image.usage', { used: formatBytes(props.imageUsage.usedBytes), limit: formatBytes(props.imageUsage.limitBytes) })}`}
          </small>
        </div>
        <RuleSwitch label={t('stepEditor.required')} explanation={t(local.required ? 'stepEditor.requiredOn' : 'stepEditor.requiredOff')} checked={local.required} onChange={(required) => set({ required })} />
        <RuleSwitch label={t('stepEditor.critical')} explanation={t('stepEditor.criticalHint')} checked={local.critical} onChange={(critical) => set({ critical })} />
        <details className="option-group">
          <summary>
            <span className="option-label">{t('stepEditor.advanced')}</span>
            <span className="muted option-value">
              {t('stepEditor.advancedSummary', { skip: t(`policy.short.${local.skipReasonPolicy}`), na: t(`policy.short.${local.notApplicableReasonPolicy}`) })}
            </span>
          </summary>
          <div className="stack option-body">
            <PolicySelect label={t('stepEditor.whenSkipped')} value={local.skipReasonPolicy} onChange={(skipReasonPolicy) => set({ skipReasonPolicy })} />
            <PolicySelect label={t('stepEditor.whenNotApplicable')} value={local.notApplicableReasonPolicy} onChange={(notApplicableReasonPolicy) => set({ notApplicableReasonPolicy })} />
            <small className="muted">{t('stepEditor.advancedHint')}</small>
          </div>
        </details>
      </div>
      <div className="step-editor-foot">
        <small className="muted" role="status">
          {dirty ? t('stepEditor.unapplied') : t('stepEditor.footNote')}
        </small>
        <div className="row">
          <button type="button" onClick={props.onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary">
            {t('stepEditor.apply')}
          </button>
        </div>
      </div>
    </form>
  );
}
