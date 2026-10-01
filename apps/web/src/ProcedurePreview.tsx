import type { ProcedureContent } from './api.ts';
import { t } from './i18n/index.ts';
import { AppIcon } from './procedure-icons.tsx';
import { StateBadge } from './Runs.tsx';
import { StepImage } from './StepImage.tsx';
import { StepMarks } from './StepMarks.tsx';

/**
 * How the Procedure will look while it is executed (15.2), built from the editor's current content.
 * Display only: it calls no API that creates a Run, sends nothing and writes no history — the buttons
 * are the real ones, switched off. Every Step is pending, as at the start of an execution.
 */
export function ProcedurePreview({ content, workspaceId }: { content: ProcedureContent; workspaceId: string }) {
  const steps = content.sections.flatMap((section) => section.steps);
  return (
    <div className="preview">
      <div className="card stack">
        <h3 style={{ margin: 0 }}>
          <AppIcon name={content.icon} decorative /> {content.title.trim() === '' ? t('builder.untitled') : content.title}
        </h3>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={0} aria-label={t('run.progressLabel')}>
          <span style={{ width: '0%' }} />
        </div>
        <small className="muted">{t('run.progress', { resolved: 0, count: steps.length })}</small>
        {content.description !== '' && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{content.description}</p>}
      </div>
      {steps.length === 0 && <p className="muted">{t('preview.empty')}</p>}
      {content.sections
        .filter((section) => section.steps.length > 0)
        .map((section, sectionIndex) => (
          <section key={section.id ?? `new-${sectionIndex}`} aria-label={t('run.sectionLabel', { title: section.title })}>
            <h4 className="preview-section">{section.title}</h4>
            {section.description !== '' && <p className="muted">{section.description}</p>}
            <ol className="plain-list">
              {section.steps.map((step, stepIndex) => (
                <li key={step.id ?? `new-${stepIndex}`} className="step" data-state="PENDING">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <p className="step-title">
                      {step.icon !== null && (
                        <>
                          <AppIcon name={step.icon} decorative />{' '}
                        </>
                      )}
                      {step.title}
                      <StepMarks required={step.required} critical={step.critical} />
                    </p>
                    <StateBadge state="PENDING" />
                  </div>
                  {step.description !== '' && <p style={{ whiteSpace: 'pre-wrap', margin: '0.5rem 0 0' }}>{step.description}</p>}
                  {step.image != null && <StepImage workspaceId={workspaceId} image={step.image} />}
                  <div className="row step-actions">
                    <button type="button" className="done-action" disabled>
                      {t(step.critical ? 'hold.short' : 'step.doneShort')}
                    </button>
                    <button type="button" disabled>
                      {t('step.skip')}
                    </button>
                    <button type="button" disabled>
                      {t('step.notApplicable')}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
    </div>
  );
}
