// eslint.config.mjs — flat config covering app/ + worker/ (issue #14).
//
// Installed from the tooling-only root package.json. Plain (non-type-checked)
// recommended presets: no tsconfig project needed, so the CI lint job runs on
// the root install alone. Note the root `typescript` pin is 6.x — that is
// typescript-eslint's parser peer range (<6.1.0); the app/worker builds keep
// their own TypeScript 7 (native compiler) and are unaffected.

import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Build/generated output (also .gitignored, but be explicit for local runs).
  // .claude/worktrees/ holds agent git worktrees — full checkouts whose own
  // tsconfigs would otherwise be linted (and break root-dir inference below).
  {
    ignores: [
      '**/dist/',
      'app/dev-dist/',
      '**/coverage/',
      '.wrangler/',
      '.claude/worktrees/**',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  // Pin the parser's root explicitly: with worktrees present, auto-detection
  // sees multiple candidate tsconfig roots and refuses to parse anything.
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },

  // React hooks rules for the app UI (includes the React Compiler checks)
  {
    files: ['app/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },

  // Node scripts (icons generator, headless acceptance walk)
  {
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: globals.node },
  },

  // The acceptance walk embeds page.evaluate() callbacks that run in the
  // browser, so it legitimately references both worlds' globals.
  {
    files: ['app/tests/e2e/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
)
