/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/client/**/*.{js,jsx,ts,tsx}',
  ],
  important: '.openreel-studio-root',
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'var(--bg)',
          1: 'var(--bg-1)',
          2: 'var(--bg-2)',
          3: 'var(--bg-3)',
          elev: 'var(--bg-elev)',
        },
        fg: {
          DEFAULT: 'var(--fg)',
          2: 'var(--fg-2)',
          3: 'var(--fg-3)',
          muted: 'var(--fg-muted)',
        },
        'border-strong': 'var(--border-strong)',
        hover: 'var(--hover)',
        selected: 'var(--selected)',
        'stage-bg': 'var(--stage-bg)',
        'tl-bg': 'var(--tl-bg)',
        'track-bg': 'var(--track-bg)',
        waveform: 'var(--waveform)',
        accent: {
          DEFAULT: 'var(--accent)',
          strong: 'var(--accent-strong)',
          soft: 'var(--accent-soft)',
          fg: 'var(--accent-fg)',
          foreground: 'var(--accent-fg)',
          glow: 'var(--accent-glow)',
          /* Export 按钮内部分隔线：派生自 --accent-fg，双主题自动跟随 */
          divider: 'var(--accent-divider)',
        },
        clip: {
          video: 'var(--c-video)',
          text: 'var(--c-text)',
          audio: 'var(--c-audio)',
          music: 'var(--c-music)',
        },
        background: {
          DEFAULT: 'hsl(var(--background) / <alpha-value>)',
          secondary: 'var(--bg-1)',
          tertiary: 'var(--bg-2)',
          elevated: 'var(--bg-elev)',
        },
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
          hover: 'var(--accent-strong)',
          active: 'var(--accent-strong)',
          glow: 'var(--accent-glow)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'var(--border)',
          hover: 'var(--border-strong)',
          active: 'var(--border-strong)',
        },
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        text: {
          primary: 'var(--fg)',
          secondary: 'var(--fg-2)',
          muted: 'var(--fg-3)',
        },
        status: {
          success: 'var(--accent)',
          warning: '#eab308',
          error: '#ef4444',
          info: '#3b82f6',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'monospace'],
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        glow: '0 2px 8px var(--accent-glow)',
        'glow-lg': '0 4px 14px var(--accent-glow)',
        panel: 'var(--shadow-md)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: '0.75rem',
        '2xl': '1rem',
      },
      spacing: {
        topbar: 'var(--topbar-h)',
        toolnav: 'var(--toolnav-h)',
        'tl-track': 'var(--tl-track)',
        'tl-rail': 'var(--tl-rail)',
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '1.3' }],
        'xs+': ['10.5px', { lineHeight: '1.35' }],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [],
}
