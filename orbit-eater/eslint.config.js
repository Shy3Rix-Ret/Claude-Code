// Lint-Konfiguration ohne Zusatzpakete:  npx eslint .
const browser = Object.fromEntries([
  'window', 'document', 'performance', 'requestAnimationFrame', 'matchMedia', 'localStorage',
  'setTimeout', 'clearTimeout', 'setInterval', 'location', 'URLSearchParams', 'Intl', 'DOMMatrix',
  'console', 'navigator', 'devicePixelRatio',
].map(k => [k, 'readonly']));
const node = { process: 'readonly', console: 'readonly' };

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none' }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-self-assign': 'error',
  'no-redeclare': 'error',
  'no-shadow-restricted-names': 'error',
  'no-unsafe-finally': 'error',
  'no-fallthrough': 'error',
  'eqeqeq': ['error', 'always'],
  'prefer-const': 'error',
  'no-var': 'error',
};

export default [
  { files: ['js/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browser }, rules },
  { files: ['tools/**/*.mjs', 'eslint.config.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: node }, rules },
];
