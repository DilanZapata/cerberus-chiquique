import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0b0b0b',
          secondary: '#52514e',
          muted: '#898781',
        },
        surface: {
          page: '#f9f9f7',
          card: '#fcfcfb',
        },
        line: {
          hair: '#e1e0d9',
          axis: '#c3c2b7',
        },
        brand: {
          50: '#eaf2fd',
          100: '#cde2fb',
          200: '#9ec5f4',
          300: '#6da7ec',
          400: '#3987e5',
          500: '#2a78d6',
          600: '#256abf',
          700: '#184f95',
          800: '#104281',
          900: '#0d366b',
        },
        series: {
          blue: '#2a78d6',
          aqua: '#1baf7a',
          yellow: '#eda100',
          green: '#008300',
          violet: '#4a3aa7',
          red: '#e34948',
          magenta: '#e87ba4',
          orange: '#eb6834',
        },
        status: {
          good: '#0ca30c',
          warning: '#fab219',
          serious: '#ec835a',
          critical: '#d03b3b',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,11,11,0.04), 0 1px 12px rgba(11,11,11,0.03)',
        popover: '0 8px 30px rgba(11,11,11,0.12)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
