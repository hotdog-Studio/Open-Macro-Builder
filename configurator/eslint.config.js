import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'dist-electron', 'node_modules', '../coverage'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: ['electron/**', 'scripts/**', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
)
