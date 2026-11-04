/**
 * Per-account presentation preferences (Step 8.7). Not security-relevant: they change how the web
 * client looks and how critical Steps are confirmed, never what the server allows.
 */
import { PLACE_THEMES, type PlaceTheme } from './places.ts';

/** Persisted allowlist: `dark` remains a compatibility alias of `memento-mori` in presentation.
 * Fixed themes; then one theme per Places country (section 30), generated from `PLACE_IDS`. */
export const BASE_THEME_PREFERENCES = ['system', 'light', 'dark', 'memento-mori', 'tokyo-nights', 'witch-forest', 'space-guide'] as const;
export type ThemePreference = (typeof BASE_THEME_PREFERENCES)[number] | PlaceTheme;
export const THEME_PREFERENCES = [...BASE_THEME_PREFERENCES, ...PLACE_THEMES] as unknown as readonly [ThemePreference, ...ThemePreference[]];

/** `hold`: press and hold for one second (5.3). `tap-confirm`: tap, then confirm in a second step. */
export const CRITICAL_CONFIRM_MODES = ['hold', 'tap-confirm'] as const;
export type CriticalConfirmMode = (typeof CRITICAL_CONFIRM_MODES)[number];

/** Navigable tools only: Today and More are structural, Moon is a Today card. */
export const NAVIGATION_TOOLS = ['PROCEDURES', 'LISTS', 'REMINDERS', 'CALENDAR', 'JOURNAL', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT', 'BRING', 'RECIPES'] as const;
export type NavigationTool = typeof NAVIGATION_TOOLS[number];
/** Partial orders keep future/new tools reachable by appending the remaining defaults. */
export function orderedNavigationTools(order: readonly NavigationTool[] | null): readonly NavigationTool[] {
  return [...(order ?? []), ...NAVIGATION_TOOLS.filter(tool => !order?.includes(tool))];
}

/** Card backgrounds in the Galactic Guide. Each picture is bundled with the web app; none is fetched. */
export const GUIDE_CARD_STYLES = ['glass', 'starfield', 'forest', 'water', 'hearth'] as const;
export type GuideCardStyle = (typeof GUIDE_CARD_STYLES)[number];
export interface GuidePreferences {
  readonly layout: 'guide' | 'classic';
  readonly cardStyle: GuideCardStyle;
  readonly cardOpacity: number;
  readonly images: boolean;
}
export const DEFAULT_GUIDE_PREFERENCES: GuidePreferences = Object.freeze({ layout: 'guide', cardStyle: 'glass', cardOpacity: 50, images: true });

/** A bounded device copy is presentation only; malformed/old values are ignored. */
export function readGuidePreferences(value: unknown): GuidePreferences | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4 || (record.layout !== 'guide' && record.layout !== 'classic') || !(GUIDE_CARD_STYLES as readonly unknown[]).includes(record.cardStyle) || typeof record.cardOpacity !== 'number' || !Number.isInteger(record.cardOpacity) || record.cardOpacity < 0 || record.cardOpacity > 100 || typeof record.images !== 'boolean') return null;
  return { layout: record.layout as GuidePreferences['layout'], cardStyle: record.cardStyle as GuideCardStyle, cardOpacity: record.cardOpacity, images: record.images };
}

export interface UserPreferences {
  readonly guide: GuidePreferences;
  readonly theme: ThemePreference;
  readonly criticalConfirm: CriticalConfirmMode;
  readonly privateGamification: boolean;
  readonly navigationOrder: readonly NavigationTool[] | null;
}

export const DEFAULT_PREFERENCES: UserPreferences = Object.freeze({ guide: DEFAULT_GUIDE_PREFERENCES, theme: 'system', criticalConfirm: 'hold', navigationOrder: null, privateGamification: true });

/**
 * A person's own choices per Workspace (section 28): which Workspace opens first, and a theme for a
 * Workspace that differs from their default theme. Presentation only; never shared, never in a backup.
 * Only Workspaces the person is currently a member of are listed.
 */
export interface WorkspacePreferences {
  readonly defaultWorkspaceId: string | null;
  /** Workspace id → theme. A Workspace without an entry uses the default theme. */
  readonly themes: Readonly<Record<string, ThemePreference>>;
}

export const EMPTY_WORKSPACE_PREFERENCES: WorkspacePreferences = Object.freeze({ defaultWorkspaceId: null, themes: Object.freeze({}) });
