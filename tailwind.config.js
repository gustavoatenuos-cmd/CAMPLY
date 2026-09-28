/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        brand: {
          green: '#34D399',
          deep: '#113B30',
          ink: '#0B0C0F',
          paper: '#F7F8FA',
          soft: '#D8DEE8',
          muted: '#8B94A3',
          line: '#20242D',
          surface: '#111318',
          surface2: '#171A20',
        },
      },
      boxShadow: {
        brand: '0 10px 24px rgba(0, 0, 0, 0.18)',
        glow: '0 1px 2px rgba(0, 0, 0, 0.24)',
        glass: '0 8px 24px rgba(0, 0, 0, 0.20)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass-gradient': 'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0))',
      },
      backdropBlur: {
        glass: '4px',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.72' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out forwards',
        'fade-up': 'fade-up 0.25s ease-out forwards',
        'pulse-glow': 'pulse-glow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
