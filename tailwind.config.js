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
          green: '#00E599',     // Neon premium green
          deep: '#0F5132',      // Dark green for backgrounds
          ink: '#090A0F',       // Ultra dark background
          paper: '#F8FAFC',     // Light mode paper
          soft: '#E2E8F0',      // Soft text
          muted: '#94A3B8',     // Muted text
          line: '#1E293B',      // Subtle borders
          surface: '#12141D',   // Card background
          surface2: '#1A1D27',  // Hover surface
        },
      },
      boxShadow: {
        brand: '0 14px 34px rgba(0, 229, 153, 0.15)',
        glow: '0 0 20px rgba(0, 229, 153, 0.3)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.3)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)',
      },
      backdropBlur: {
        glass: '12px',
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
        "pulse-glow": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.8", transform: "scale(1.05)", boxShadow: "0 0 25px rgba(0, 229, 153, 0.5)" },
        }
      },
      animation: {
        "fade-in": "fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "fade-up": "fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "pulse-glow": "pulse-glow 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
