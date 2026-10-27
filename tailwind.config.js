/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          orange: '#F36B21',
          'orange-dark': '#d95a14',
          'orange-light': '#fde8d8',
          'orange-muted': '#fdf0e8',
          black: '#050708',
          'black-soft': '#1a1c1e',
          'black-muted': '#2d3035',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
