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
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
    },
  },
  plugins: [],
};
