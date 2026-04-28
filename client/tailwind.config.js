/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['Unbounded', 'system-ui', 'sans-serif'],
        body: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['Space Grotesk', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        'tighter-plus': '-0.035em',
      },
      colors: {
        brand: {
          gold:   '#F5A623',
          orange: '#FF6A00',
          green:  '#2ECC71',
          blue:   '#1E90FF',
          dark:   '#0B0F1A',
          'dark-1': '#11172A',
          'dark-2': '#151B2D',
          'dark-3': '#1C2340',
        },
        amber: {
          50:  '#FFF8EB', 100: '#FFEECC', 200: '#FCD98E', 300: '#FAC95F',
          400: '#F8B83D', 450: '#F5A623', 500: '#F5A623', 600: '#D98E17', 700: '#B0700E',
          800: '#7F500C', 900: '#4F3208', 950: '#2A1B04',
        },
        orange: {
          50:  '#FFF2E5', 100: '#FFDDBF', 200: '#FFBE85', 300: '#FF9F4B',
          400: '#FF852A', 500: '#FF6A00', 600: '#DB5900', 700: '#A74300',
          800: '#733000', 900: '#3E1A00', 950: '#1F0D00',
        },
        emerald: {
          50:  '#EAFAF1', 100: '#CFF5DF', 200: '#9BEAC0', 300: '#69DEA1',
          400: '#42D389', 500: '#2ECC71', 600: '#22A95C', 700: '#1B8148',
          800: '#135931', 900: '#0B321B', 950: '#061B0F',
        },
        blue: {
          50:  '#E6F2FF', 100: '#BFDDFF', 200: '#8BC3FF', 300: '#57A9FF',
          400: '#3BA0FF', 500: '#1E90FF', 600: '#1878DB', 700: '#115DAB',
          800: '#0B407A', 900: '#062548', 950: '#031326',
        },
      },
    },
  },
  plugins: [],
};
