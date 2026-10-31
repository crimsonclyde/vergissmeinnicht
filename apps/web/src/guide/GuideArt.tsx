import { usePreferences } from '../preferences.tsx';
import { useThemeMode } from '../theme.ts';
import bring from './art/bring.webp';
import calendar from './art/calendar.webp';
import contacts from './art/contacts.webp';
import documents from './art/documents.webp';
import equipment from './art/equipment.webp';
import fireplace from './art/fireplace.webp';
import journal from './art/journal.webp';
import lists from './art/lists.webp';
import maintenance from './art/maintenance.webp';
import procedures from './art/procedures.webp';
import reminders from './art/reminders.webp';
import water from './art/water.webp';

const ART = { water, bring, calendar, contacts, documents, equipment, fireplace, journal, lists, maintenance, procedures, reminders };
export type GuideArtKind = keyof typeof ART;
/** Bundled decoration only. Record names and stored icon keys never select a URL. */
export function GuideArt({ kind }: { kind: GuideArtKind }) {
  const [mode] = useThemeMode();
  const { preferences } = usePreferences();
  if (mode !== 'space-guide' || !preferences.guide.images || preferences.guide.layout !== 'guide') return null;
  return <img className="guide-art" src={ART[kind]} width={240} height={180} loading="lazy" decoding="async" alt="" aria-hidden="true" />;
}
