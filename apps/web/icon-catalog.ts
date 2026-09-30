import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates the Tabler part of the icon catalogue (steps.md 12.13) from `icon-selection.json` and the
 * metadata shipped with `@tabler/icons` (names, tags). Outputs:
 * - `src/icon-catalog.generated.ts`: artwork imports, labels, categories and search words;
 * - `packages/domain/src/procedure-icon-keys.generated.ts`: the trusted keys, append-only.
 * Stored icon keys must never change or disappear, so the generator refuses to drop a key that an
 * earlier run produced. `node icon-catalog.ts --check` fails when the committed files are stale.
 */

const WEB = dirname(fileURLToPath(import.meta.url));
const PATHS = {
  selection: join(WEB, 'icon-selection.json'),
  registry: join(WEB, 'src', 'procedure-icons.tsx'),
  catalog: join(WEB, 'src', 'icon-catalog.generated.ts'),
  domainKeys: join(WEB, '..', '..', 'packages', 'domain', 'src', 'procedure-icon-keys.generated.ts'),
};

interface TablerIcon {
  readonly name: string;
  readonly category?: string;
  readonly tags?: readonly (string | number)[];
  readonly styles?: { readonly outline?: unknown };
}

export interface CatalogInput {
  readonly selection: Readonly<Record<string, unknown>>;
  readonly tabler: Readonly<Record<string, TablerIcon>>;
  readonly tablerVersion: string;
  /** Source of the hand-written registry (`src/procedure-icons.tsx`). */
  readonly registrySource: string;
  /** Keys generated before (current domain file); none may disappear. */
  readonly previousKeys: readonly string[];
}

export interface CatalogOutput {
  readonly catalog: string;
  readonly domainKeys: string;
  readonly keys: readonly string[];
}

const KEY = /^[a-z][a-z0-9-]{0,39}$/;

export const pascal = (name: string): string =>
  `Icon${name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}`;

/** Search words: lower-case, split on anything but letters and digits, de-duplicated, minus `except`. */
function words(text: string, except: ReadonlySet<string> = new Set()): string {
  const seen = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word !== '' && !except.has(word) && !/^\d+$/.test(word)) seen.add(word);
  }
  return [...seen].join(' ');
}

const quote = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const property = (key: string): string => (/^[a-z][a-z0-9]*$/i.test(key) ? key : quote(key));

/** Hand-written registry entries: key → artwork export name (Tabler `Icon…` or a drawn `…Art`). */
export function curatedEntries(registrySource: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const match of registrySource.matchAll(/^ {2}'?([a-z][a-z0-9-]*)'?: \{ art: (\w+),/gm)) {
    entries.set(match[1] ?? '', match[2] ?? '');
  }
  return entries;
}

export function buildCatalog(input: CatalogInput): CatalogOutput {
  const curated = curatedEntries(input.registrySource);
  if (curated.size === 0) throw new Error('No hand-written icon entries found in src/procedure-icons.tsx.');
  const usedArt = new Map<string, string>([...curated].map(([key, art]) => [art, key]));
  const problems: string[] = [];
  const entries: { key: string; art: string; group: string; label: string; aliases: string; tags: string }[] = [];
  const keys = new Set<string>();
  const ignoreTags = new Map(
    Object.entries((input.selection.$ignoreTags ?? {}) as Record<string, string>)
      .filter(([key]) => !key.startsWith('$'))
      .map(([key, list]) => [key, new Set(words(list).split(' '))]),
  );
  const tagsOf = (key: string, tags: readonly (string | number)[], known: ReadonlySet<string>) =>
    words(tags.join(' '), new Set([...known, ...(ignoreTags.get(key) ?? [])]));

  for (const [group, list] of Object.entries(input.selection)) {
    if (group.startsWith('$')) continue;
    for (const spec of list as readonly string[]) {
      const [head = '', label = '', aliases = ''] = spec.split('|');
      const [name = '', keyOverride] = head.split('>');
      const key = keyOverride ?? name;
      const icon = input.tabler[name];
      if (icon?.styles?.outline === undefined) {
        problems.push(`"${name}" is not an outline icon of @tabler/icons ${input.tablerVersion}`);
        continue;
      }
      const art = pascal(name);
      if (!KEY.test(key)) problems.push(`key "${key}" must match ${KEY}`);
      if (curated.has(key)) problems.push(`key "${key}" is already a hand-written icon (use "${name}>other-key")`);
      if (keys.has(key)) problems.push(`key "${key}" is selected twice`);
      if (usedArt.has(art)) problems.push(`"${name}" is already the artwork of "${usedArt.get(art) ?? ''}"`);
      keys.add(key);
      usedArt.set(art, key);
      const finalLabel = label.trim() !== '' ? label.trim() : name.replace(/-\d+$/, '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
      const strong = words(`${aliases}`);
      const known = new Set([...words(`${finalLabel} ${key}`).split(' '), ...strong.split(' ')]);
      entries.push({ key, art, group, label: finalLabel, aliases: strong, tags: tagsOf(key, icon.tags ?? [], known) });
    }
  }
  for (const key of ignoreTags.keys()) {
    if (!keys.has(key) && !curated.has(key)) problems.push(`$ignoreTags names unknown key "${key}"`);
  }
  for (const key of input.previousKeys) {
    if (!keys.has(key)) problems.push(`key "${key}" was generated before and is stored in data: it must stay in icon-selection.json`);
  }
  if (problems.length > 0) throw new Error(`Icon selection is invalid:\n- ${problems.join('\n- ')}`);

  // Tabler tags of the artwork behind hand-written entries widen their search, too.
  const byArt = new Map(Object.values(input.tabler).map((icon) => [pascal(icon.name), icon]));
  const curatedTags = [...curated].flatMap(([key, art]) => {
    const tags = byArt.get(art)?.tags;
    return tags === undefined ? [] : [[key, tagsOf(key, tags, new Set(key.split('-')))] as const];
  });

  const imports = [...new Set(entries.map((entry) => entry.art))].sort();
  const header = `// Generated by \`pnpm --filter @vergissmeinnicht/web icons:generate\` (apps/web/icon-catalog.ts) from
// apps/web/icon-selection.json and the @tabler/icons ${input.tablerVersion} metadata. Do not edit by hand.
`;
  const catalog = `${header}import {
${imports.map((art) => `  ${art},`).join('\n')}
} from '@tabler/icons-react';
import type { GeneratedIconEntry } from './procedure-icons.tsx';

/** Tabler icons offered in addition to the hand-written entries (labels are English, like the catalog). */
export const GENERATED_ICONS = {
${entries
  .map((entry) => `  ${property(entry.key)}: { art: ${entry.art}, group: ${quote(entry.group)}, label: ${quote(entry.label)}, aliases: ${quote(entry.aliases)}, tags: ${quote(entry.tags)} },`)
  .join('\n')}
} as const satisfies Record<string, GeneratedIconEntry>;

/** Tabler's tags for the artwork of hand-written entries (extra, weaker search words). */
export const CURATED_TABLER_TAGS: Readonly<Record<string, string>> = {
${curatedTags.map(([key, tags]) => `  ${property(key)}: ${quote(tags)},`).join('\n')}
};
`;
  const ordered = [...input.previousKeys, ...entries.map((entry) => entry.key).filter((key) => !input.previousKeys.includes(key))];
  const domainKeys = `${header}
/** Icon keys offered from Tabler Icons (web: src/icon-catalog.generated.ts). Append-only: stored data uses them. */
export const GENERATED_ICON_KEYS = [
${ordered.map((key) => `  ${quote(key)},`).join('\n')}
] as const;
`;
  return { catalog, domainKeys, keys: ordered };
}

export function readInput(): CatalogInput {
  // The metadata files are not in the package's `exports`; pnpm links the (dev) dependency here.
  const tablerRoot = join(WEB, 'node_modules', '@tabler', 'icons');
  let previousKeys: string[];
  try {
    previousKeys = [...readFileSync(PATHS.domainKeys, 'utf8').matchAll(/^ {2}'([a-z][a-z0-9-]*)',$/gm)].map((match) => match[1] ?? '');
  } catch {
    previousKeys = [];
  }
  return {
    selection: JSON.parse(readFileSync(PATHS.selection, 'utf8')) as Record<string, unknown>,
    tabler: JSON.parse(readFileSync(join(tablerRoot, 'icons.json'), 'utf8')) as Record<string, TablerIcon>,
    tablerVersion: (JSON.parse(readFileSync(join(tablerRoot, 'package.json'), 'utf8')) as { version: string }).version,
    registrySource: readFileSync(PATHS.registry, 'utf8'),
    previousKeys,
  };
}

/** Whether the committed generated files match what the generator produces now. */
export function catalogIsCurrent(): boolean {
  const output = buildCatalog(readInput());
  return readFileSync(PATHS.catalog, 'utf8') === output.catalog && readFileSync(PATHS.domainKeys, 'utf8') === output.domainKeys;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = buildCatalog(readInput());
  if (process.argv.includes('--check')) {
    if (!catalogIsCurrent()) {
      console.error('Generated icon catalogue is stale: run `pnpm --filter @vergissmeinnicht/web icons:generate`.');
      process.exit(1);
    }
  } else {
    writeFileSync(PATHS.catalog, output.catalog);
    writeFileSync(PATHS.domainKeys, output.domainKeys);
    console.log(`${output.keys.length} generated icon keys.`);
  }
}
