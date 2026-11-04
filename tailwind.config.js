/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--app-bg)',
        foreground: 'var(--app-fg)',
        card: {
          DEFAULT: 'var(--card-bg)',
          foreground: 'var(--card-fg)',
        },
        primary: {
          DEFAULT: 'var(--primary-color)',
          foreground: 'var(--primary-fg)',
        },
        secondary: {
          DEFAULT: 'var(--secondary-bg)',
          foreground: 'var(--secondary-fg)',
        },
        muted: {
          DEFAULT: 'var(--muted-bg)',
          foreground: 'var(--muted-fg)',
        },
        border: 'var(--border-color)',
        input: 'var(--border-color)',
        ring: 'var(--primary-color)',
        destructive: {
          DEFAULT: 'var(--destructive-color)',
          foreground: '#ffffff',
        }
      },
      fontFamily: {
        sans: ['Montserrat', 'system-ui', 'sans-serif'],
        display: ['Montserrat', 'system-ui', 'sans-serif'],
        montserrat: ['Montserrat', 'sans-serif'],
        mono: ['Roboto Mono', 'Cascadia Mono', 'Consolas', 'monospace'],
      }
    },
  },
  plugins: [],
}
