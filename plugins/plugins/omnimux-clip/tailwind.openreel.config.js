const token = name => ({ opacityValue }) => opacityValue === undefined
  ? `var(--${name})`
  : `color-mix(in srgb, var(--${name}) calc(${opacityValue} * 100%), transparent)`

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
          DEFAULT: token('bg'),
          1: token('bg-1'),
          2: token('bg-2'),
          3: token('bg-3'),
          elev: token('bg-elev'),
        },
        fg: {
          DEFAULT: token('fg'),
          2: token('fg-2'),
          3: token('fg-3'),
          muted: token('fg-muted'),
        },
        'border-strong': token('border-strong'),
        hover: token('hover'),
        selected: token('selected'),
        'stage-bg': token('stage-bg'),
        'tl-bg': token('tl-bg'),
        'track-bg': token('track-bg'),
        waveform: token('waveform'),
        accent: {
          DEFAULT: token('accent'),
          strong: token('accent-strong'),
          soft: token('accent-soft'),
          fg: token('accent-fg'),
          foreground: token('accent-fg'),
          glow: token('accent-glow'),
          /* Export 按钮内部分隔线：派生自 --accent-fg，双主题自动跟随 */
          divider: 'var(--accent-divider)',
        },
        clip: {
          video: token('c-video'),
          text: token('c-text'),
          audio: token('c-audio'),
          music: token('c-music'),
        },
        background: {
          DEFAULT: token('bg'),
          secondary: token('bg-1'),
          tertiary: token('bg-2'),
          elevated: token('bg-elev'),
        },
        foreground: token('fg'),
        card: {
          DEFAULT: token('bg-1'),
          foreground: token('fg'),
        },
        popover: {
          DEFAULT: token('bg-elev'),
          foreground: token('fg'),
        },
        primary: {
          DEFAULT: token('accent'),
          foreground: token('accent-fg'),
          hover: token('accent-strong'),
          active: token('accent-strong'),
          glow: token('accent-glow'),
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
          DEFAULT: token('border'),
          hover: token('border-strong'),
          active: token('border-strong'),
        },
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        text: {
          primary: token('fg'),
          secondary: token('fg-2'),
          muted: token('fg-3'),
        },
        status: {
          success: token('accent'),
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
