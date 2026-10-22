/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(214 32% 91%)',
        background: 'hsl(0 0% 100%)',
        foreground: 'hsl(222 47% 11%)',
        muted: 'hsl(210 40% 96%)',
        'muted-foreground': 'hsl(215 16% 47%)',
        primary: { DEFAULT: 'hsl(222 47% 20%)', foreground: 'hsl(210 40% 98%)' },
        accent: { DEFAULT: 'hsl(210 40% 96%)', foreground: 'hsl(222 47% 11%)' },
        destructive: { DEFAULT: 'hsl(0 72% 51%)', foreground: 'hsl(0 0% 100%)' },
      },
      borderRadius: { lg: '0.6rem', md: '0.45rem', sm: '0.3rem' },
    },
  },
  plugins: [],
};
