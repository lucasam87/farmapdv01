import path from 'node:path'
import { defineConfig } from 'vitest/config'

// O alias `@/*` do tsconfig aponta para a raiz do projeto. Sem isto, um teste
// que importa codigo da aplicacao (que usa `@/...` por dentro) nao resolve.
// Criado na Task 8 do plano 2, quando o primeiro teste precisou importar codigo
// de `app/` — o plano 1 tinha adiado isso de proposito.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname),
    },
  },
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**', 'tests/e2e/**'],
  },
})
