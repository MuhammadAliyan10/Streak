/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#4F46E5',
        'primary-secondary': '#6366F1',
        'primary-light': '#E0E7FF',
        ink: '#0F172A',
        canvas: '#F8FAFC',
      },
      spacing: { 18: '4.5rem', 22: '5.5rem' },
      borderRadius: { xl: '1rem', '2xl': '1.5rem' },
    },
  },
  plugins: [],
};
