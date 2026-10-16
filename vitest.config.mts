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
      // O pacote `server-only` NAO esta instalado (e o plano proibe instalar
      // dependencia). O Next resolve `import 'server-only'` no compilador, mas o
      // Vitest nao: sem este alias, um teste que importe um modulo server-only
      // morre em "Failed to resolve import". Ver `tests/stubs/vazio.ts`.
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/vazio.ts'),
    },
  },
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**', 'tests/e2e/**'],
  },
})
