import { RECENT_RETENTIONS, TODAY_DENSITIES, TO_BUY_LISTS_MAX, TO_BUY_LISTS_MIN, type TodayCardId } from '@vergissmeinnicht/domain';
import { useState } from 'react';
import { messageFor } from './api.ts';
import { t, type MessageKey } from './i18n/index.ts';
import { changeCard, moveCard, type TodaySettings as Settings } from './today-cards.ts';
import { useTodaySettings } from './today-settings.ts';
import { Link, paths } from './router.tsx';

const TITLES: Record<TodayCardId, MessageKey> = {
  attention: 'today.needsAttention',
  continue: 'today.continue',
  next: 'today.nextUp',
  toBuy: 'today.lists',
  maintenance: 'today.maintenance',
  recent: 'progress.recent',
  progress: 'progress.heading',
  calendar: 'today.calendar',
  clock: 'today.clock',
  weather: 'today.weather',
};

/**
 * Profile & settings → Today (19.2): which cards this person sees, their order, size and options, and the
 * density — one layout in every Workspace. Personal presentation only: a card of a tool that is off in
 * the Workspace is listed with a note and never appears, whatever is chosen here.
 * `tools`: the tools of the Workspace last opened, for that note (UI only); `null` when unknown.
 */
export function TodaySettings({ userId, tools, weatherOn }: { userId: string; tools: readonly string[] | null; weatherOn: boolean }) {
  const { settings, loaded, save } = useTodaySettings(userId);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const apply = (next: Settings | null) => {
    setMessage(null);
    setSaved(false);
    save(next).then(
      () => setSaved(true),
      (caught: unknown) => setMessage(messageFor(caught)),
    );
  };
  if (!loaded) return <p>{t('common.loading')}</p>;
  return (
    <div className="stack today-settings">
      <h3>{t('todaySettings.heading')}</h3>
      <p className="muted">{t('todaySettings.lead')}</p>
      {message !== null && <p role="alert">{message}</p>}
      <p role="status" className="muted">
        {saved ? t('todaySettings.saved') : ''}
      </p>
      <ol className="plain-list today-settings-cards" aria-label={t('todaySettings.cards')}>
        {settings.cards.map((setting, index) => {
          const { card } = setting;
          // Weather is not offered at all while the server has it switched off (W1); its place in the order is kept.
          if (card.id === 'weather' && !weatherOn) return null;
          const title = t(TITLES[card.id]);
          const unused = tools !== null && card.anyOf.length > 0 && !card.anyOf.some((tool) => tools.includes(tool));
          const id = `today-card-setting-${card.id}`;
          return (
            <li key={card.id} className="today-settings-card">
              <div className="today-settings-row">
                <label className="row today-settings-toggle">
                  <input type="checkbox" checked={setting.visible} onChange={(event) => apply(changeCard(settings, card.id, { visible: event.target.checked }))} />
                  <strong>{title}</strong>
                </label>
                <span className="today-settings-move">
                  <button type="button" className="quiet" disabled={index === 0} aria-label={t('todaySettings.moveUp', { title })} onClick={() => apply(moveCard(settings, card.id, -1))}>
                    ↑
                  </button>
                  <button type="button" className="quiet" disabled={index === settings.cards.length - 1} aria-label={t('todaySettings.moveDown', { title })} onClick={() => apply(moveCard(settings, card.id, 1))}>
                    ↓
                  </button>
                </span>
              </div>
              {unused && <small className="muted">{t('todaySettings.notUsed')}</small>}
              {setting.visible && (
                <div className="today-settings-options">
                  {card.canBeWide && (
                    <label htmlFor={`${id}-size`}>
                      {t('todaySettings.size')}
                      <select id={`${id}-size`} value={setting.size} onChange={(event) => apply(changeCard(settings, card.id, { size: event.target.value === 'WIDE' ? 'WIDE' : 'NORMAL' }))}>
                        <option value="NORMAL">{t('todaySettings.size.NORMAL')}</option>
                        <option value="WIDE">{t('todaySettings.size.WIDE')}</option>
                      </select>
                    </label>
                  )}
                  {card.id === 'toBuy' && (
                    <label htmlFor={`${id}-lists`}>
                      {t('todaySettings.lists')}
                      <select id={`${id}-lists`} value={setting.lists} onChange={(event) => apply(changeCard(settings, card.id, { lists: Number(event.target.value) }))}>
                        {Array.from({ length: TO_BUY_LISTS_MAX - TO_BUY_LISTS_MIN + 1 }, (_unused, offset) => TO_BUY_LISTS_MIN + offset).map((count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {card.id === 'weather' && (
                    <Link href={paths.account('weather')}>{t('todaySettings.weatherSettings')}</Link>
                  )}
                  {card.id === 'clock' && (
                    <label className="row">
                      <input type="checkbox" checked={setting.hour24} onChange={(event) => apply(changeCard(settings, card.id, { hour24: event.target.checked }))} />
                      {t('todaySettings.hour24')}
                    </label>
                  )}
                  {card.id === 'recent' && (
                    <label htmlFor={`${id}-retention`}>
                      {t('todaySettings.retention')}
                      <select
                        id={`${id}-retention`}
                        value={setting.retention}
                        onChange={(event) => {
                          const retention = RECENT_RETENTIONS.find((value) => value === event.target.value);
                          if (retention !== undefined) apply(changeCard(settings, card.id, { retention }));
                        }}
                      >
                        {RECENT_RETENTIONS.map((value) => (
                          <option key={value} value={value}>
                            {t(`todaySettings.retention.${value}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <fieldset>
        <legend>{t('todaySettings.density')}</legend>
        {TODAY_DENSITIES.map((value) => (
          <label key={value} className="row" style={{ fontWeight: 400 }}>
            <input type="radio" name="today-density" value={value} checked={settings.density === value} onChange={() => apply({ ...settings, density: value })} />
            <span>{t(`todaySettings.density.${value}`)}</span>
          </label>
        ))}
      </fieldset>
      <p className="muted">{t('todaySettings.wideHint')}</p>
      <button type="button" onClick={() => apply(null)}>
        {t('todaySettings.reset')}
      </button>
    </div>
  );
}
