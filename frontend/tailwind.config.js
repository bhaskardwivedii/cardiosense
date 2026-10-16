/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F6F8FA',
        ink: '#13212C',
        slate: { DEFAULT: '#5A6A77', light: '#8A98A4' },
        line: '#DDE3E8',
        brand: { DEFAULT: '#0E5A73', dark: '#0A4457', soft: '#E6F0F3' },
        ecg: { paper: '#FFF6F7', minor: '#F8DDE1', major: '#EFB8C1' },
        risk: { low: '#2E7D5B', moderate: '#A86A12', high: '#C2410C', vhigh: '#B42318' },
      },
      fontFamily: { sans: ['"Public Sans Variable"', '"Public Sans"', 'system-ui', 'sans-serif'] },
      boxShadow: { panel: '0 1px 2px rgba(19,33,44,0.06), 0 0 0 1px rgba(19,33,44,0.06)' },
    },
  },
  plugins: [],
}
