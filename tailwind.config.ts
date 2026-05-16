import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg:       'var(--bg)',
        surface:  'var(--surface)',
        surface2: 'var(--surface2)',
        surface3: 'var(--surface3)',
        border:   'var(--border)',
        'border-soft': 'var(--border-soft)',
        text:     'var(--text)',
        'text-2': 'var(--text-2)',
        muted:    'var(--muted)',
        accent:   'var(--accent)',
        accent2:  'var(--accent2)',
        ok:       'var(--ok)',
        warn:     'var(--warn)',
        ng:       'var(--ng)',
        pelton:   '#7c4dff',
        francis:  '#0099e6',
        kaplan:   '#00b87a',
      },
      fontFamily: {
        sans: ["'DM Sans'", "'Noto Sans JP'", 'sans-serif'],
        mono: ["'IBM Plex Mono'", 'monospace'],
      },
      borderRadius: {
        xl:  '12px',
        '2xl': '16px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.03)',
        'card-hover': '0 2px 8px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.05)',
      },
    },
  },
  plugins: [],
}
export default config
