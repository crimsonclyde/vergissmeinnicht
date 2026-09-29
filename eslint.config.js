import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const infrastructure = [
  'react',
  'react-dom',
  'react/*',
  'react-dom/*',
  'fastify',
  '@fastify/*',
  'better-auth',
  'better-auth/*',
  'drizzle-orm',
  'drizzle-orm/*',
  'better-sqlite3',
  'node:sqlite',
];

/** Architecture boundaries (AGENTS.md / docu/architecture.md). Dependencies point inward. */
const restrict = (patterns, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: patterns, message }] }],
});

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'playwright-report/**', 'test-results/**', '.var/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['packages/domain/**'],
    rules: restrict(
      [...infrastructure, '@vergissmeinnicht/*'],
      'Domain must not depend on UI, HTTP, auth, DB or other layers.',
    ),
  },
  {
    files: ['packages/permissions/**', 'packages/application/**', 'packages/import-export/**'],
    rules: restrict(
      [...infrastructure, '@vergissmeinnicht/database', '@vergissmeinnicht/auth', '@vergissmeinnicht/realtime', '@vergissmeinnicht/notifications', '@vergissmeinnicht/email'],
      'Application/policy code depends on the domain and ports, not on infrastructure.',
    ),
  },
  {
    files: ['apps/web/**', 'packages/ui/**'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...restrict(
        [
          'node:*',
          'fastify',
          '@fastify/*',
          'drizzle-orm',
          'drizzle-orm/*',
          'better-sqlite3',
          '@vergissmeinnicht/database',
          '@vergissmeinnicht/auth',
          '@vergissmeinnicht/realtime',
          '@vergissmeinnicht/notifications',
          '@vergissmeinnicht/application',
          '@vergissmeinnicht/permissions',
        ],
        'The web client never accesses the DB or server-side layers; it talks to the API over HTTP/SSE.',
      ),
    },
  },
  {
    // Build tooling of the web app (runs in Node at build time, never shipped to the browser).
    files: ['apps/web/vite.config.ts', 'apps/web/third-party-notices.ts', 'apps/web/src/third-party-notices.test.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // i18n readiness (steps.md 8.4): dates and numbers are formatted in one place, for one locale.
    files: ['apps/web/src/**'],
    ignores: ['apps/web/src/i18n/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].map((property) => ({
          property,
          message: 'Use formatDateTime/formatTime from ./i18n so formatting follows the app locale.',
        })),
      ],
    },
  },
);
