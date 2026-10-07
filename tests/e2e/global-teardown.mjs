// Desmonta o cenario dos testes de ponta a ponta (Task 13).
//
// O globalSetup abre um caixa no terminal 'e2e' e cria produtos para a suite
// poder vender. Sem desmontar, essa sessao fica ABERTA no banco depois da
// rodada, e isso quebra a suite SQL: os casos que provam "venda sem caixa
// aberto e recusada" (010_venda, caso 6) e todos os que chamam abrir_caixa
// (030_caixa, 040_views, 050_permissoes) passam a falhar com "Ja existe um
// caixa aberto." — foi exatamente o que aconteceu depois da primeira rodada
// verde do e2e.
//
// O Playwright chama o teardown mesmo quando um teste falha. Se o processo for
// morto no meio (Ctrl+C), ele nao roda — mas o limpar() do inicio da proxima
// rodada conserta, porque e idempotente.

import { limpar } from './global-setup.mjs'

export default async function globalTeardown() {
  await limpar()
  console.log('[e2e] cenario desmontado: vendas, produtos, cliente e caixa do e2e removidos')
}
