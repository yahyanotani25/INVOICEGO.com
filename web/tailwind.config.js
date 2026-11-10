/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#f1efff', 100: '#e4e0ff', 200: '#cbc3ff', 300: '#a99bff', 400: '#8a74fb', 500: '#6d52f4', 600: '#5b3ee6', 700: '#4c30c7', 800: '#3e29a1', 900: '#34267f' },
        ink: { 50: '#f6f7fb', 100: '#eceff5', 200: '#dbe1ec', 300: '#c0c8d8', 400: '#8e98ad', 500: '#5b6475', 600: '#434b5c', 700: '#2f3645', 800: '#1e2433', 900: '#121722' },
        navy: '#1e2a5a',
      },
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
      boxShadow: {
        soft: '0 1px 2px rgba(18,23,34,0.04), 0 4px 16px -4px rgba(18,23,34,0.08)',
        lift: '0 2px 4px rgba(18,23,34,0.05), 0 12px 28px -8px rgba(18,23,34,0.16)',
        glow: '0 8px 24px -6px rgba(91,62,230,0.45)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        pop: { from: { opacity: '0', transform: 'translateY(-4px) scale(0.98)' }, to: { opacity: '1', transform: 'translateY(0) scale(1)' } },
        'dialog-in': { from: { opacity: '0', transform: 'translateY(12px) scale(0.97)' }, to: { opacity: '1', transform: 'translateY(0) scale(1)' } },
        'toast-in': { from: { opacity: '0', transform: 'translateX(24px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        shimmer: { from: { backgroundPosition: '-400px 0' }, to: { backgroundPosition: '400px 0' } },
        float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        blob: { '0%, 100%': { transform: 'translate(0,0) scale(1)' }, '33%': { transform: 'translate(30px,-20px) scale(1.08)' }, '66%': { transform: 'translate(-20px,20px) scale(0.95)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out both',
        'fade-up': 'fade-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        pop: 'pop 0.16s cubic-bezier(0.22, 1, 0.36, 1) both',
        'dialog-in': 'dialog-in 0.22s cubic-bezier(0.22, 1, 0.36, 1) both',
        'toast-in': 'toast-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-left': 'slide-in-left 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.3s linear infinite',
        float: 'float 6s ease-in-out infinite',
        blob: 'blob 14s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
