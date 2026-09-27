import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { t } from './i18n/index.ts';

/** Shown until the server answers; the server's value names the source of the running version. */
const UPSTREAM_SOURCE_URL = 'https://github.com/crimsonclyde/vergissmeinnicht';

/** Every page offers the source code to its users (AGPL-3.0 §13). */
export function SourceFooter() {
  const [sourceCodeUrl, setSourceCodeUrl] = useState(UPSTREAM_SOURCE_URL);
  useEffect(() => {
    let active = true;
    api.about().then(
      (about) => active && setSourceCodeUrl(about.sourceCodeUrl),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);
  return (
    <footer className="app-footer">
      {t('footer.license')}{' '}
      <a href={sourceCodeUrl} rel="noopener noreferrer">
        {t('footer.source')}
      </a>
    </footer>
  );
}
