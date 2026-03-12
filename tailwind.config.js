/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0,0,0,0.04), 0 1px 2px -1px rgba(0,0,0,0.03)',
        elevated: '0 4px 24px -4px rgba(0,0,0,0.08)',
        dropdown: '0 10px 40px -8px rgba(0,0,0,0.12), 0 4px 12px -2px rgba(0,0,0,0.05)',
      },
      borderRadius: {
        panel: '1rem',
      },
      colors: {
        brand: {
          50:  '#eef4ff',
          100: '#d9e5ff',
          200: '#bbcfff',
          300: '#8db0ff',
          400: '#5a85ff',
          500: '#1769FF',
          600: '#0052e0',
          700: '#003eb5',
          800: '#003394',
          900: '#001f5c',
        },
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(-4px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(100%)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        rise: 'rise 400ms ease-out both',
        fadeIn: 'fadeIn 200ms ease-out both',
        slideUp: 'slideUp 250ms ease-out both',
      },
    },
  },
  plugins: [],
}

