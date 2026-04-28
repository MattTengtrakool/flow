import type {Config} from 'tailwindcss';

export default {
  content: [
    './index.html',
    './electron/renderer/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--bg-panel)',
        elevated: 'var(--bg-elevated)',
        input: 'var(--bg-input)',
        border: 'var(--border)',
        divider: 'var(--divider)',
        text: 'var(--text)',
        muted: 'var(--text-muted)',
        faint: 'var(--text-faint)',
        accent: 'var(--accent)',
      },
      borderRadius: {
        notionSm: 'var(--radius-sm)',
        notionMd: 'var(--radius-md)',
        notionLg: 'var(--radius-lg)',
      },
      boxShadow: {
        notion: 'var(--shadow-1)',
        popover: 'var(--shadow-2)',
      },
      fontSize: {
        caption: 'var(--font-caption)',
        body: 'var(--font-body)',
        title: 'var(--font-title)',
        display: 'var(--font-display)',
      },
    },
  },
} satisfies Config;
