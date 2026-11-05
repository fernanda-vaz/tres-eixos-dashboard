import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

// Em desenvolvimento, o painel chama /api/... e o Vite repassa para a API sem o prefixo /api,
// igual ao nginx em produção. Mesma origem para o navegador: sem CORS e o cookie de sessão funciona.
// A porta da API vem do PORT do .env da raiz do projeto (ou de API_TARGET, se definido).
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '')
  const apiTarget = process.env.API_TARGET ?? `http://localhost:${rootEnv.PORT || '8080'}`

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
