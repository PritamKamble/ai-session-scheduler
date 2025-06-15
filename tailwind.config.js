/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
    './src/app/components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        mono: ['Fira Mono', 'ui-monospace', 'SFMono-Regular'],
      },
      colors: {
        primary: {
          DEFAULT: '#2563eb',
          dark: '#1e40af',
        },
        accent: '#f59e42',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
      },
      borderRadius: {
        xl: '1rem',
      },
      boxShadow: {
        card: '0 2px 8px 0 rgba(0,0,0,0.07)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        scaleIn: {
          '0%': { opacity: 0, transform: 'scale(0.95)' },
          '100%': { opacity: 1, transform: 'scale(1)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.4s ease-in',
        scaleIn: 'scaleIn 0.3s cubic-bezier(0.4,0,0.2,1)',
      },
    },
  },
  safelist: [
    'animate-spin',
    'animate-fadeIn',
    'animate-scaleIn',
    'text-primary',
    'text-accent',
    'bg-primary',
    'bg-accent',
    'dark',
  ],
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
}; 