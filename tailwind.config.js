/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        void: '#05010e', // deep-space background
        panel: '#0c0622', // HUD panel background
        ink: '#e6f0ff', // default text
        neon: {
          green: '#39ff14',
          blue: '#00e5ff',
          purple: '#b537ff',
          pink: '#ff2d95',
          amber: '#ffc233',
          teal: '#2dffc4',
        },
      },
      fontFamily: {
        pixel: ['"Press Start 2P"', 'monospace'], // retro headers / buttons
        term: ['VT323', 'monospace'], // CRT terminal body
        mono: ['"Space Mono"', 'ui-monospace', 'monospace'], // UI mono
      },
      boxShadow: {
        'neon-green': '0 0 4px rgba(57,255,20,.8), 0 0 18px rgba(57,255,20,.4)',
        'neon-blue': '0 0 4px rgba(0,229,255,.8), 0 0 18px rgba(0,229,255,.4)',
        'neon-purple': '0 0 4px rgba(181,55,255,.8), 0 0 18px rgba(181,55,255,.4)',
        'neon-pink': '0 0 4px rgba(255,45,149,.8), 0 0 18px rgba(255,45,149,.4)',
        hud: '0 0 0 1px rgba(6,2,20,.9), 0 0 28px rgba(76,29,149,.25), inset 0 0 42px rgba(2,132,199,.06)',
      },
      keyframes: {
        blink: {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
        flicker: {
          '0%, 91%, 94%, 100%': { opacity: '1' },
          '92%': { opacity: '.55' },
          '96%': { opacity: '.7' },
        },
        floaty: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        scanline: {
          '0%': { transform: 'translateY(-120%)' },
          '100%': { transform: 'translateY(1400%)' },
        },
      },
      animation: {
        blink: 'blink 1s step-end infinite',
        flicker: 'flicker 4s linear infinite',
        floaty: 'floaty 6s ease-in-out infinite',
      },
      backgroundImage: {
        'grid-hud':
          'linear-gradient(rgba(0,229,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,.05) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid-hud': '44px 44px',
      },
    },
  },
  plugins: [],
};
