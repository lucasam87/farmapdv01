import base from './playwright.config'

// CONFIG OPCIONAL, SO PARA A SUITE DO AGENTE — nao substitui nada.
//
// `playwright.config.ts` continua sendo o config do `npm run test:e2e` e o unico
// que sobe o cenario (`globalSetup`) e o desmonta (`globalTeardown`). Este aqui
// existe porque o agente NAO USA O BANCO: nao cria venda, nao abre caixa, nao
// toca produto nem cliente. Rodar `npx playwright test agente` com o config
// padrao executa o `globalSetup` inteiro (que abre um caixa no terminal `e2e` e
// cria produtos no banco de PRODUCAO) para nada, e o `limpar()` do teardown
// apaga dados de verdade que outro teste possa estar usando — alem de a suite
// SQL nao poder rodar com caixa aberto depois.
//
// Este config apaga as duas fases de cenario e nada mais. Ele e opt-in
// (`--config playwright.sem-cenario.config.ts`), entao nao muda o comportamento
// de `npm run test:e2e` nem o de nenhum outro arquivo de `tests/e2e`: quem
// depende do caixa aberto e dos produtos do cenario tem de rodar pelo config
// padrao. Serve para rodar a spec do agente enquanto o banco/projeto Supabase
// nao estiver acessivel, e para economizar uma ida desnecessaria ao banco de
// producao quando o alvo e so o agente.
const config = {
  ...base,
  globalSetup: undefined,
  globalTeardown: undefined,
}

export default config
