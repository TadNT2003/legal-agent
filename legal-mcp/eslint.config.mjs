import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.config.mjs', '*.config.ts', '*.config.js'],
        },
        tsconfigRootDir: String(import.meta.dirname),
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
    },
  },
  {
    // Mocking class-typed dependencies as plain objects (`{...} as unknown as
    // SomeClass`) makes every bare `mock.method` reference in `expect(...)`
    // trip this rule, even wrapped in `jest.mocked()`. Test-only ergonomics,
    // not a real unbound-`this` risk since nothing here is ever called
    // detached from its mock object.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
