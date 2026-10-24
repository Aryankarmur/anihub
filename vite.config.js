import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'grouping-preview') {
    throw new Error('The emulator-only grouping preview cannot be built for deployment.')
  }

  return {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: './tests/setup.js',
      css: true,
    },
  }
})
