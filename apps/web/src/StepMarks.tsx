import { t } from './i18n/index.ts';

/**
 * Compact Step flags instead of prose: a red "!" for critical Steps (named for screen readers,
 * explained in the tooltip) and a small tag for optional ones. Required is the normal case and
 * needs no mark.
 */
export function StepMarks({ required, critical }: { required: boolean; critical: boolean }) {
  return (
    <>
      {critical && (
        <span className="critical-mark" role="img" aria-label={t('mark.critical')} title={t('mark.criticalHint')}>
          !
        </span>
      )}
      {!required && <span className="optional-tag">{t('mark.optional')}</span>}
    </>
  );
}
