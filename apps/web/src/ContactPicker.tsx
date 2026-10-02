import { useEffect, useId, useState } from 'react';
import { api, type ContactSummary } from './api.ts';
import { contactContext } from './contact-model.ts';
import { t } from './i18n/index.ts';

/** Finds one Contact by searching names, organisations, categories, numbers and addresses — the search the Contacts page uses. */
export function ContactPicker(props: { workspaceId: string; exclude: readonly string[]; value: string; onChange: (id: string) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [found, setFound] = useState<readonly ContactSummary[] | null>(null);
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(text.trim() === '' ? {} : { q: text.trim() });
      api.contacts(props.workspaceId, params.toString()).then(
        (page) => current && setFound(page.contacts),
        () => current && setFound([]),
      );
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [props.workspaceId, text]);
  const options = (found ?? []).filter((each) => !props.exclude.includes(each.id));
  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-q`}>{t('contacts.pick.search')}</label>
        <input id={`${id}-q`} type="search" maxLength={100} value={text} onChange={(event) => setText(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-contact`}>{t('contacts.pick.contact')}</label>
        <select id={`${id}-contact`} required value={props.value} onChange={(event) => props.onChange(event.target.value)}>
          <option value="">{found === null ? t('common.loading') : options.length === 0 ? t('links.pick.none') : t('links.pick.choose')}</option>
          {options.map((each) => {
            const context = contactContext(each);
            return (
              <option key={each.id} value={each.id}>
                {context === '' ? each.name : `${each.name} (${context})`}
              </option>
            );
          })}
        </select>
      </div>
    </>
  );
}
