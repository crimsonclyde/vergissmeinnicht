/** Temporary security disposition for GHSA-fc5q-39xc-vjpf; remove with the upstream upgrade. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
assert(Date.now() < Date.UTC(2026, 10, 24), 'picomatch audit disposition expired: review upstream fix and remove the exception');
assert.equal(sha256(resolve(root, 'patches/picomatch@4.0.7.patch')), 'c5ddb00a6e2bad9e79b12ead440947675df81cb3c9ca7fe533bbc2a567e0baec');
const workspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
assert.match(workspace, /picomatch@4\.0\.7: patches\/picomatch@4\.0\.7\.patch/);
const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
// Any new version requires a fresh review instead of inheriting the exception.
const versions = [...lock.matchAll(/^ {2}picomatch@([^:(]+)(?:\(|:)/gm)].map(match => match[1]);
assert(versions.length > 0 && versions.every(version => version === '4.0.7'), 'unreviewed picomatch version');
const resolutions = [...lock.slice(lock.lastIndexOf('\nsnapshots:\n')).matchAll(/^ {6}picomatch: ([^\n]+)$/gm)].map(match => match[1]);
assert(resolutions.length > 0 && resolutions.every(value => value === '4.0.7(patch_hash=c5ddb00a6e2bad9e79b12ead440947675df81cb3c9ca7fe533bbc2a567e0baec)'), 'unpatched dependency edge');
const require = createRequire(import.meta.url);
const webRequire = createRequire(resolve(root, 'apps/web/package.json'));
const owners = [require.resolve('vitest/package.json'), webRequire.resolve('vite/package.json')];
const paths = new Set(owners.map(owner => createRequire(owner).resolve('picomatch')));
for (const path of paths) {
  assert.equal(sha256(resolve(dirname(path), 'lib/parse.js')), 'e0346f4bbdb66ad739d574eba6a77d9ada85a27fe50738cb697a3dda99dbe12f', 'required patch is not installed');
  execFileSync(process.execPath, ['--input-type=commonjs', '-e', `
    const assert = require('node:assert/strict');
    const pm = require(process.argv[1]);
    for (const options of [{}, { maxExtglobRecursion: false }]) {
      for (const pattern of ['+(*)b', '+(*a)b', '*(*)b', '*(*a)b', '+(a?)b', '+(+(a))b']) {
        assert.equal(pm.isMatch('a'.repeat(40) + '!', pattern, options), false);
        assert.equal(pm.isMatch(pattern, pattern, options), true);
      }
    }
    assert(pm.isMatch('src/nested/file.ts', 'src/**/*.ts'));
    assert(pm.isMatch('src/view.tsx', '**/*.{ts,tsx}'));
    assert(pm.isMatch('testspec.ts', '+(test|spec).ts'));
    assert(!pm.isMatch('src/file.js', 'src/**/*.ts'));
  `, path], { timeout: 2000, stdio: 'pipe' });
}
console.log('Verified pinned picomatch mitigation, bounded hostile-pattern probes and normal glob matching; exception expires 2026-11-24.');
