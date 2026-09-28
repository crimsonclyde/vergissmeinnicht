import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { t } from './i18n/index.ts';

/** Shown until the server answers; the server's value names the source of the running version. */
const UPSTREAM_SOURCE_URL = 'https://github.com/crimsonclyde/vergissmeinnicht';
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
const FOOTER_EVENT = 'vmn:footer-hidden';

/** The admin page changed the setting: the footer on this page follows without a reload. */
export function announceFooterHidden(hidden: boolean): void {
  window.dispatchEvent(new CustomEvent<boolean>(FOOTER_EVENT, { detail: hidden }));
}

/**
 * "VergissMeinNicht (VMN) with 🖤 by CrimsonClyde - Licence: AGPL-3.0". The name links to the source
 * code (AGPL-3.0 §13). A server admin can hide the footer (8.10): it then stays in the HTML with the
 * `hidden` attribute. Hidden until the server answered, so a hidden footer never flashes up.
 */
export function SourceFooter() {
  const [about, setAbout] = useState<{ sourceCodeUrl: string; footerHidden: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    api.about().then(
      (loaded) => active && setAbout(loaded),
      // Unreachable (e.g. offline): show the footer with the upstream link.
      () => active && setAbout({ sourceCodeUrl: UPSTREAM_SOURCE_URL, footerHidden: false }),
    );
    const onChange = (event: Event) => {
      const hidden = (event as CustomEvent<boolean>).detail;
      setAbout((current) => ({ sourceCodeUrl: current?.sourceCodeUrl ?? UPSTREAM_SOURCE_URL, footerHidden: hidden }));
    };
    window.addEventListener(FOOTER_EVENT, onChange);
    return () => {
      active = false;
      window.removeEventListener(FOOTER_EVENT, onChange);
    };
  }, []);
  return (
    <footer className="app-footer" hidden={about === null || about.footerHidden}>
      <a href={about?.sourceCodeUrl ?? UPSTREAM_SOURCE_URL} rel="noopener noreferrer">
        {t('footer.name')}
      </a>{' '}
      {t('footer.with')}{' '}
      <span role="img" className="footer-heart" aria-label={t('footer.love')}>
        🖤
      </span>{' '}
      {t('footer.by')} - {t('footer.licence')}{' '}
      <a href={LICENSE_URL} rel="noopener noreferrer">
        AGPL-3.0
      </a>
    </footer>
  );
}
