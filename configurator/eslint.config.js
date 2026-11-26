import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'dist-electron', 'release', 'node_modules', '../coverage'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    // src/core/update/canonical.mjs: plain JavaScript the page and the build script share.
    files: ['src/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // core stays pure: no Node, Electron, React or browser-only globals.
    files: ['src/core/**/*.{ts,mjs}'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['node:*', 'electron', 'react', 'react-dom'] },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'core must not touch the browser window.' },
        { name: 'document', message: 'core must not touch the DOM.' },
      ],
    },
  },
  {
    files: ['electron/**', 'scripts/**', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The browser tests' harness (test/browser/harness.tsx) waits for every command still in flight before
    // the next test starts, and keeps that wait inside its hook's time limit by bounding how long one
    // command may be (LONGEST_COMMAND). That bound holds only while each test awaits each command it sends:
    // one left running is not timed by its test and can hold the clean-up for most of the limit. This rule
    // keeps every promise awaited. It needs the types, so only these files are linted with them
    // (tsconfig.json covers src and test); the rest of the lint stays without.
    files: ['src/**/*.browser.test.tsx', 'test/browser/**/*.{ts,tsx}'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
)
