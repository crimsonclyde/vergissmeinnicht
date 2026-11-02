import {lazy,Suspense} from 'react';
import {t} from '../../i18n/index.ts';
const Page=lazy(()=>import('./JournalPage.tsx').then(module=>({default:module.JournalPage})));
/** Keep the editor/parser out of the ordinary tool navigation bundle. */
export function JournalPage(props:Parameters<typeof import('./JournalPage.tsx').JournalPage>[0]){return <Suspense fallback={<p>{t('journal.loading')}</p>}><Page {...props}/></Suspense>;}
