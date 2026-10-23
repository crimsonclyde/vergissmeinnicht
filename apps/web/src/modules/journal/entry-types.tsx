import { useId } from 'react';
import type { JournalContent } from '@vergissmeinnicht/domain';
import { t } from '../../i18n/index.ts';

/** Presentation half of the bundled registry; no user-supplied component name or dynamic import. */
export const ENTRY_RENDERERS = Object.freeze({ note: NoteFields });
function NoteFields({ value, onChange }: { value: JournalContent; onChange: (next: JournalContent) => void }) {
  const id = useId();
  return <div className="stack"><label htmlFor={id}>{t('journal.body')}</label><textarea id={id} value={value.body} maxLength={50_000} onChange={(event) => onChange({ ...value, body: event.target.value })} /></div>;
}
