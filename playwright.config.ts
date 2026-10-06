import { defineConfig, devices } from '@playwright/test'

// Teste de ponta a ponta do PDV (nivel 3 da spec 12): e a unica forma de provar
// o que a suite de unidade nao alcanca — teclado de verdade, clique DUPLO no
// botao de finalizar e o F3 global.
//
// O `webServer` sobe o dev server sozinho e derruba no fim: sem isso, alguem
// precisaria lembrar de subir o Next antes, e um dev server orfao trava o
// proximo `npm run dev` (o Next 16 usa trava de instancia unica — problema ja
// visto na Etapa 1).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // a suite faz vendas de verdade no mesmo banco
  workers: 1,
  // Prepara o cenario real (produto com estoque e caixa aberto no terminal e2e)
  // antes da suite: sem isso o PDV recusaria com "Abra o caixa para comecar a
  // vender." e o teste mediria a coisa errada.
  globalSetup: './tests/e2e/global-setup.mjs',
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
