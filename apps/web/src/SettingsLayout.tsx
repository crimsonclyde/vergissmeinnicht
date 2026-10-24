import type { ReactNode } from 'react';
import { Link } from './router.tsx';
import { UiIcon, type UiIconName } from './ui-icons.tsx';

export interface SettingsSection {
  readonly href: string;
  readonly label: string;
  readonly current: boolean;
  /** The section's icon (section 29): shown in the menu, and alone with a small label on phones. */
  readonly icon?: UiIconName;
  /** A short group heading; consecutive sections with the same group are listed together. */
  readonly group?: string;
}

/** Consecutive sections of the same group, in their order. */
export function groupSections(sections: readonly SettingsSection[]): { group: string | undefined; sections: SettingsSection[] }[] {
  const groups: { group: string | undefined; sections: SettingsSection[] }[] = [];
  for (const section of sections) {
    const last = groups.at(-1);
    if (last !== undefined && last.group === section.group) last.sections.push(section);
    else groups.push({ group: section.group, sections: [section] });
  }
  return groups;
}

/**
 * One layout for every settings area (15.1) — Profile & settings, Workspace settings, Server admin:
 * a title, the named sections, and only the chosen section's content. Sections are links (their own
 * addresses), so nothing unrelated has to be scrolled past and each can be opened directly. Since
 * section 29 sections carry an icon and a group: a grouped list on wide screens, a grid of icon tiles
 * on phones (nothing scrolls sideways).
 */
export function SettingsLayout(props: { title: string; subtitle?: string; identity?: ReactNode; navLabel: string; sections: readonly SettingsSection[]; children: ReactNode }) {
  return (
    <>
      <div className="page-header settings-header">
        {props.identity ?? (
          <>
            <h2>{props.title}</h2>
            {props.subtitle !== undefined && <span className="muted">{props.subtitle}</span>}
          </>
        )}
      </div>
      <div className="settings-layout">
        <nav aria-label={props.navLabel} className="settings-nav">
          {groupSections(props.sections).map(({ group, sections }, index) => (
            <div key={group ?? index} className="settings-group">
              {group !== undefined && (
                <span className="settings-group-label" aria-hidden="true">
                  {group}
                </span>
              )}
              {sections.map((section) => (
                <Link key={section.href} href={section.href} aria-current={section.current ? 'page' : undefined}>
                  {section.icon !== undefined && <UiIcon name={section.icon} />}
                  <span className="settings-nav-label">{section.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-content">{props.children}</div>
      </div>
    </>
  );
}
