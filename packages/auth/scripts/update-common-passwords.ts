// Maintainer tool (13.3): rebuilds data/common-passwords.txt.gz from public breach corpora.
// Needs network access; never used by the running server. See data/README.md.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { passwordComparisonForm } from '@vergissmeinnicht/domain';

const BASE = 'https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials';
const SOURCES = ['100k-most-used-passwords-NCSC.txt', 'xato-net-10-million-passwords-1000000.txt', 'Pwdb_top-10000000.txt'];
const LIMIT = 60_000;
const MIN_LENGTH = 15;
const MAX_LENGTH = 128;
const EXTRA = ['correcthorsebatterystaple', 'vergissmeinnicht', 'vergissmeinnicht1', 'vergissmeinnicht123', 'thequickbrownfoxjumpsoverthelazydog'];
const HASH_LIKE = /^\*?(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{16,}$/;

const lists = await Promise.all(
  SOURCES.map(async (name) => {
    const response = await fetch(`${BASE}/${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return (await response.text()).split(/\r?\n/);
  }),
);

const seen = new Set<string>();
const longest = Math.max(...lists.map((list) => list.length));
for (let rank = 0; rank < longest && seen.size < LIMIT; rank++) {
  for (const list of lists) {
    const password = list[rank];
    if (password === undefined || password.includes('�') || password.length < MIN_LENGTH || password.length > MAX_LENGTH) continue;
    const form = passwordComparisonForm(password);
    if ([...form].length < MIN_LENGTH || HASH_LIKE.test(form)) continue;
    seen.add(form);
    if (seen.size >= LIMIT) break;
  }
}
for (const extra of EXTRA) seen.add(extra);

const target = new URL('../data/common-passwords.txt.gz', import.meta.url);
writeFileSync(target, gzipSync(`${[...seen].join('\n')}\n`, { level: 9 }));
console.log(`${seen.size} passwords written to ${target.pathname}`);
