/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
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
    },
  },
  plugins: [],
};
