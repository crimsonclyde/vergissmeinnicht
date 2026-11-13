import { useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type EquipmentRecord, type MaintenanceDueSoonItem } from './api.ts';
import { CoreToolsContext } from './core-tools.ts';
import { formatRelativeDay, t } from './i18n/index.ts';
import { maintenanceTabs, rememberMaintenanceTab, type MaintenanceTab } from './maintenance-area.ts';
import { Link, paths } from './router.tsx';
import { localDate } from './Timeline.tsx';
import { UiIcon, type UiIconName } from './ui-icons.tsx';
import './area.css';
import './maintenance-area.css';

/**
 * The head of the Maintenance area (41.2): eyebrow, serif title with a muted count, the two tabs
 * (Maintenance | Equipment, each only while its tool is on) and the page's own round actions.
 */
export function MaintenanceAreaHead(props: { workspaceId: string; current: MaintenanceTab; headingId: string; count?: number | null; lead?: string; children?: ReactNode }) {
  const tools = useContext(CoreToolsContext);
  const tabs = maintenanceTabs(tools);
  const { workspaceId, current } = props;
  useEffect(() => rememberMaintenanceTab(workspaceId, current), [workspaceId, current]);
  const title = t(props.current === 'equipment' ? 'shell.equipment' : 'shell.maintenance');
  return (
    <>
      <div className="area-head">
        <div className="area-title">
          <p className="area-eyebrow"><UiIcon name="maintenance" /> {t('maintenanceArea.eyebrow')}</p>
          <h2 id={props.headingId} className="area-heading">
            {title}
            {props.count !== undefined && props.count !== null && <> <span className="area-heading-muted">{props.count}</span></>}
          </h2>
        </div>
        <div className="area-actions">
          {tabs.length > 1 && (
            <nav className="ma-tabs" aria-label={t('maintenanceArea.tabs')}>
              {tabs.map((tab) => (
                <Link key={tab} href={tab === 'equipment' ? paths.equipment(props.workspaceId) : paths.maintenance(props.workspaceId)} aria-current={tab === props.current ? 'page' : undefined}>
                  <UiIcon name={tab} /> <span>{t(tab === 'equipment' ? 'shell.equipment' : 'shell.maintenance')}</span>
                </Link>
              ))}
            </nav>
          )}
          {props.children}
        </div>
      </div>
      {props.lead !== undefined && <p className="area-lead">{props.lead}</p>}
    </>
  );
}

type Glance = { key: string; icon: UiIconName; label: string; title: string; note: string; href: string; tone?: 'overdue' | 'warn' };

const WARRANTY_DAYS = 90;

/**
 * The painted cover band with up to three things worth a glance: the next work, how much is due soon, and
 * the warranty that ends first. Each comes from an existing read (Maintenance due soon, the Equipment list)
 * and only while its tool is on; nothing here is new data. The picture is decoration.
 */
export function MaintenanceCover(props: { workspaceId: string; equipment?: readonly EquipmentRecord[] | null }) {
  const tools = useContext(CoreToolsContext);
  const [{ today, limit }] = useState(() => ({ today: localDate(new Date()), limit: localDate(new Date(Date.now() + WARRANTY_DAYS * 86_400_000)) }));
  const [due, setDue] = useState<{ items: readonly MaintenanceDueSoonItem[]; total: number } | null>(null);
  const [fetched, setFetched] = useState<readonly EquipmentRecord[] | null>(null);
  const own = props.equipment === undefined;
  const equipment = own ? fetched : props.equipment;
  const maintenanceOn = tools.includes('MAINTENANCE');
  const equipmentOn = tools.includes('EQUIPMENT');
  useEffect(() => {
    let active = true;
    if (maintenanceOn) api.maintenanceDueSoon(props.workspaceId, today).then((loaded) => active && setDue(loaded), () => undefined);
    return () => { active = false; };
  }, [props.workspaceId, maintenanceOn, today]);
  useEffect(() => {
    let active = true;
    if (own && equipmentOn) api.equipment(props.workspaceId, '').then((page) => active && setFetched(page.records), () => undefined);
    return () => { active = false; };
  }, [props.workspaceId, equipmentOn, own]);
  const glances: Glance[] = [];
  const next = due?.items[0];
  if (next !== undefined) {
    glances.push({ key: 'next', icon: 'maintenance', label: t(next.date < today ? 'maintenanceArea.overdue' : 'maintenanceArea.next'), title: next.title, note: [formatRelativeDay(next.date, today), next.equipment].filter(Boolean).join(' · '), href: paths.maintenanceRecord(props.workspaceId, next.id), ...(next.date < today ? { tone: 'overdue' as const } : {}) });
  }
  if (due !== null && due.total > 1) glances.push({ key: 'due', icon: 'calendar', label: t('maintenanceArea.dueSoon'), title: t('maintenanceArea.dueCount', { count: due.total }), note: t('maintenanceArea.dueNote'), href: paths.maintenance(props.workspaceId) });
  const ending = (equipment ?? []).filter((record) => record.warrantyExpiry !== null && record.warrantyExpiry >= today && record.warrantyExpiry <= limit).sort((a, b) => (a.warrantyExpiry ?? '').localeCompare(b.warrantyExpiry ?? ''))[0];
  if (ending !== undefined && ending.warrantyExpiry !== null) glances.push({ key: 'warranty', icon: 'security', label: t('maintenanceArea.warranty'), title: ending.name, note: formatRelativeDay(ending.warrantyExpiry, today), href: paths.equipmentRecord(props.workspaceId, ending.id), tone: 'warn' });
  return (
    <section className="ma-cover" aria-label={t('maintenanceArea.glance')}>
      <svg className="ma-cover-art" viewBox="0 0 960 170" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        <circle className="ma-sun" cx="760" cy="48" r="26" />
        <path className="ma-hill-far" d="M0 120 C120 92 220 100 330 112 S560 90 700 104 S880 96 960 100 V170 H0z" />
        <path className="ma-hill-mid" d="M0 140 C140 122 260 128 380 136 S620 118 760 130 S900 126 960 128 V170 H0z" />
        <g className="ma-house" transform="translate(870 76)">
          <path d="M0 40 L0 18 L26 0 L52 18 L52 40z" />
          <rect x="34" y="2" width="7" height="12" />
        </g>
        <g className="ma-window" transform="translate(870 76)"><rect x="10" y="22" width="9" height="9" /><rect x="32" y="22" width="9" height="18" /></g>
        <path className="ma-hill-near" d="M0 158 C200 148 420 152 620 156 S860 150 960 152 V170 H0z" />
      </svg>
      {glances.length > 0 ? (
        <ul className="plain-list ma-glances">
          {glances.map((glance) => (
            <li key={glance.key}>
              <Link href={glance.href} className="ma-glance" {...(glance.tone === undefined ? {} : { 'data-tone': glance.tone })}>
                <span className="ma-glance-icon"><UiIcon name={glance.icon} /></span>
                <span className="ma-glance-body"><small>{glance.label}</small><strong>{glance.title}</strong>{glance.note !== '' && <small>{glance.note}</small>}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ma-glance-calm">{t('maintenanceArea.calm')}</p>
      )}
    </section>
  );
}
