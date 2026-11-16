import os from 'node:os'
import path from 'node:path'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  cacheDir: path.join(os.tmpdir(), 'wdp301-frontend-vite-cache'),
  plugins: [react()],
  optimizeDeps: {
    include: ['three', '@react-three/fiber', '@react-three/drei'],
  },
  define: {
    'process.env': {}
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
  },
})
