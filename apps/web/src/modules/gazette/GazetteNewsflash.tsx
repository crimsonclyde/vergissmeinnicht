import { useId } from 'react';
import { t } from '../../i18n/index.ts';
import { Markdown } from '../../markdown/Markdown.tsx';

export function GazetteNewsflash({ masthead, title, intro }: { masthead: string; title: string; intro: string }) {
  const headingId = useId();
  const datedTitle = title.startsWith(`${masthead} — `) && /^\d{1,2} [\p{L}.]+ \d{4}$/u.test(title.slice(masthead.length + 3));
  const headline = title !== masthead && !datedTitle ? title : '';

  return (
    <section className="gazette-brief" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('gazette.newsflash')}</h2>
      {headline !== '' && <h3>{headline}</h3>}
      {intro !== '' && <div className="gazette-intro"><Markdown source={intro} /></div>}
    </section>
  );
}
