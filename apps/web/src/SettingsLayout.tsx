import type { ReactNode } from 'react';
import { Link } from './router.tsx';

export interface SettingsSection {
  readonly href: string;
  readonly label: string;
  readonly current: boolean;
}

/**
 * One layout for every settings area (15.1) — Profile & settings, Workspace settings, Server admin:
 * a title, the named sections, and only the chosen section's content. Sections are links (their own
 * addresses), so nothing unrelated has to be scrolled past and each can be opened directly.
 */
export function SettingsLayout(props: { title: string; subtitle?: string; navLabel: string; sections: readonly SettingsSection[]; children: ReactNode }) {
  return (
    <>
      <div className="page-header">
        <h2>{props.title}</h2>
        {props.subtitle !== undefined && <span className="muted">{props.subtitle}</span>}
      </div>
      <div className="settings-layout">
        <nav aria-label={props.navLabel} className="settings-nav">
          {props.sections.map((section) => (
            <Link key={section.href} href={section.href} aria-current={section.current ? 'page' : undefined}>
              {section.label}
            </Link>
          ))}
        </nav>
        <div className="settings-content">{props.children}</div>
      </div>
    </>
  );
}
