import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // GDC-ish industrial blue, carried through from the Phase 4 figures.
        brand: {
          50: '#eef3fb',
          100: '#d6e2f5',
          200: '#adc5ea',
          300: '#7ea3dc',
          400: '#5081cb',
          500: '#2E5395',
          600: '#274778',
          700: '#1f3860',
          800: '#182b4a',
          900: '#121f36',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
