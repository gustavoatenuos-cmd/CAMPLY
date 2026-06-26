/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
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
          green: '#22C55E',
          deep: '#0F7A5A',
          ink: '#111827',
          paper: '#F3F4F6',
          soft: '#D8DEE8',
          muted: '#9CA3AF',
          line: '#243244',
          surface: '#172133',
          surface2: '#1E2A3D',
        },
      },
      boxShadow: {
        brand: '0 14px 34px rgba(15, 122, 90, 0.22)',
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(40px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 1s ease-out forwards",
        "fade-up": "fade-up 1s ease-out forwards",
      },
    },
  },
  plugins: [],
};
