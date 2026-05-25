/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:        '#0a0a0d',
        'surface-1':  '#11141a',
        'surface-2':  '#171b22',
        violet:    '#7c5cff',
        'border-subtle': '#1f2330',
      },
    },
  },
  plugins: [],
};
