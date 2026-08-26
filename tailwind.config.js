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
        finance: {
          navy: '#0B192C',
          dark: '#1E201E',
          card: '#1F2937',
          accent: '#1E3E62',
          gold: '#FF6500',
          blue: '#2563eb',
          emerald: '#10b981',
          rose: '#f43f5e'
        }
      }
    },
  },
  plugins: [],
}
