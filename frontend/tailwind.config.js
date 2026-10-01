/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        surface: 'var(--surface)',
        border: 'var(--border)',
        'border-subtle': 'var(--border-subtle)',
        text: 'var(--text)',
        'text-2': 'var(--text-2)',
        'text-3': 'var(--text-3)',
        brand: 'var(--brand)',
        'brand-soft': 'var(--brand-soft)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
      },
      borderColor: {
        DEFAULT: 'var(--border)',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontWeight: {
        normal: '400',
        medium: '510',
        semibold: '590',
      },
      fontSize: {
        meta: ['13px', '18px'],
        ui: ['14px', '20px'],
        chat: ['15px', '24px'],
        headline: ['20px', '28px'],
        figure: ['24px', '30px'],
      },
      borderRadius: {
        control: '6px',
        card: '8px',
        panel: '12px',
      },
      boxShadow: {
        pop: '0 12px 32px -8px rgba(10, 12, 20, 0.28)',
      },
      maxWidth: {
        chat: '760px',
      },
    },
  },
  plugins: [],
};
