import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Load env variables based on mode (development/production)
  const env = loadEnv(mode, process.cwd(), '')
  
  // API URL logic:
  // - In production (Vercel): use env var if set, otherwise default to relative "/api"
  // - In development: use env var if set, otherwise fallback will be handled by proxy
  const apiUrl = env.VITE_API_URL

  return {
    plugins: [react(), tailwindcss()],
    
    // ✅ Critical: Proxy /api requests to local backend during development
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:5001', // Your local Node/Express + LocalStack backend
          changeOrigin: true,
          secure: false,
        },
        '/upload-image': {
          target: 'http://localhost:5001',
          changeOrigin: true,
          secure: false,
        }
      },
      // Optional: Allow network access for Docker/mobile testing
      host: true,
      port: 5173,
    },
    
    // ✅ Define VITE_API_URL for runtimeConfig.ts to use
    define: {
      // Only define if explicitly set — otherwise let runtimeConfig.ts fallback to "/api"
      ...(apiUrl && {
        'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
      }),
    },
    
    build: {
      outDir: 'dist',
      sourcemap: true,
      // Ensure API calls use relative paths in production
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
    
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/tests/setup.ts',
      include: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
      ],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/**',
        'server/**',
      ]
    },
  }
})