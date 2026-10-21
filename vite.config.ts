/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ORBIT_BASE lets the GitHub Pages workflow serve from /orbit/.
export default defineConfig({
  base: process.env.ORBIT_BASE ?? '/',
  plugins: [react()],
  worker: { format: 'es' },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
})
