import path from 'node:path'
import process from 'node:process'
import { test, expect, type Page } from '@playwright/test'
// Nivel 3 da spec 12: o historico de vendas (Etapa 5) pelo caminho do navegador.
//   - o dia mora no endereco e um dia torto vira aviso, nunca erro 500;
//   - a venda do PDV aparece na lista do dia e o detalhe conta o que foi vendido;
//   - cancelar com motivo marca a lista, aparece no detalhe E devolve o estoque;
//   - cancelar sem motivo e recusado e nao toca no banco;
//   - `?ocultar=1` sobrevive a lista e ao detalhe;
//   - a venda das 22h de ontem (fuso de Sao Paulo) cai em ONTEM, nao em hoje.
//
// O cenario (produto com estoque e caixa aberto no terminal 'e2e') e preparado
// pelo globalSetup, ANTES da suite.
//
// As constantes ficam repetidas aqui de proposito — o mesmo motivo do
// `venda.spec.ts`: o Playwright carrega este .ts como CommonJS e o globalSetup e
// .mjs (ESM), entao um `import` entre os dois falha com "Cannot use import
// statement outside a module".
const PRODUTO_E2E = 'PRODUTO E2E PARACETAMOL'
// Codigo de barras do PRODUTO_E2E: casa exatamente um produto, entao o caminho
// ArrowDown + Enter nao depende da ORDEM da lista de resultados.
const CODIGO_E2E = '999000111'
const TERMINAL_E2E = 'e2e'

// As credenciais do usuario de teste vivem no .env.local; o Playwright nao le
// esse arquivo sozinho (a convencao dele e .env). `__dirname` e nao
// `import.meta`: o Playwright carrega este .ts como CommonJS.
process.loadEnvFile(path.resolve(__dirname, '..', '..', '.env.local'))

const EMAIL = process.env.USUARIO_EMAIL
const SENHA = process.env.USUARIO_SENHA
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const URL_PROJETO = process.env.NEXT_PUBLIC_SUPABASE_URL

// O ref do projeto sai da propria URL do Supabase, como no global-setup.mjs.
const ref = new URL(URL_PROJETO!).hostname.split('.')[0]

/**
 * Copia local do transporte do `global-setup.mjs` (o `import` nao e possivel:
 * veja o comentario das constantes). O banco nao aceita conexao `pg`; o caminho
 * e o endpoint de gerenciamento, autenticado pelo SUPABASE_ACCESS_TOKEN.
 */
async function consultar<T>(query: string): Promise<T[]> {
  const resposta = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const texto = await resposta.text()
  if (!resposta.ok) throw new Error(`SQL falhou (HTTP ${resposta.status}): ${texto.slice(0, 400)}`)
  return texto ? (JSON.parse(texto) as T[]) : []
}

async function entrar(page: Page) {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(EMAIL!)
  await page.getByLabel('Senha').fill(SENHA!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  // O menu lateral so aparece com sessao E perfil.
  await expect(page.getByRole('link', { name: 'Nova venda' })).toBeVisible()
}

/**
 * Faz uma venda de R$ 5,00 no PDV: um PRODUTO_E2E pago em dinheiro.
 *
 * A busca e pelo CODIGO de barras porque ele casa exatamente um produto — se
 * fosse por "PRODUTO E2E" o ArrowDown escolheria o segundo da lista e o teste
 * mediria a ordem dos resultados em vez do PDV (mesmo motivo do `venda.spec.ts`).
 */
async function venderProdutoE2E(page: Page) {
  await page.goto('/vendas/nova')
  await page.getByLabel('Buscar produto').pressSequentially(CODIGO_E2E)
  await expect(page.getByTestId('resultados')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('carrinho')).toContainText(PRODUTO_E2E)

  await page.keyboard.press('F6') // dinheiro
  await page.getByLabel('Valor do pagamento').fill('10,00')
  await page.getByRole('button', { name: 'Lançar' }).click()

  await page.keyboard.press('F2') // finalizar
  await expect(page.getByTestId('confirmacao')).toContainText('registrada')
}

/**
 * Abre o detalhe da venda MAIS RECENTE que contem o PRODUTO_E2E. A lista vem
 * ordenada por `criado_em desc`, entao a venda que este teste acabou de fazer e
 * sempre a primeira — as vendas de outros testes/rodadas ficam atras.
 */
async function abrirDetalheDaVenda(page: Page) {
  await page.goto('/vendas')
  await page.getByTestId('linha-venda').filter({ hasText: PRODUTO_E2E }).first().click()
  await expect(page.getByRole('heading', { name: /^Venda \d+$/ })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await entrar(page)
})

test('anda no tempo pelo endereco e o dia torto vira aviso, nao erro', async ({ page }) => {
  // "abc" nem e data; a tela tem de cair em hoje COM aviso — nunca 500.
  await page.goto('/vendas?dia=abc')
  await expect(page.getByTestId('aviso-dia')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Vendas — Hoje' })).toBeVisible()

  // Data com formato certo e dia que nao existe (31 de fevereiro): mesmo caminho.
  await page.goto('/vendas?dia=2026-02-31')
  await expect(page.getByTestId('aviso-dia')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Vendas — Hoje' })).toBeVisible()

  await page.goto('/vendas')
  await expect(page.getByTestId('aviso-dia')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Vendas — Hoje' })).toBeVisible()

  await page.getByTestId('dia-anterior').click()
  await expect(page.getByRole('heading', { name: 'Vendas — Ontem' })).toBeVisible()

  await page.getByTestId('dia-seguinte').click()
  await expect(page.getByRole('heading', { name: 'Vendas — Hoje' })).toBeVisible()

  await page.getByTestId('dia-anterior').click()
  await expect(page.getByRole('heading', { name: 'Vendas — Ontem' })).toBeVisible()

  await page.getByTestId('dia-hoje').click()
  await expect(page.getByRole('heading', { name: 'Vendas — Hoje' })).toBeVisible()
})

test('a venda do PDV aparece no historico e o detalhe mostra o item e o total', async ({ page }) => {
  await venderProdutoE2E(page)
  await abrirDetalheDaVenda(page)

  await expect(page.getByTestId('status-venda')).toHaveText('Concluída')
  await expect(page.getByTestId('itens')).toContainText(PRODUTO_E2E)
  await expect(page.getByTestId('itens')).toContainText('R$ 5,00')
})

test('cancelar com motivo marca a lista, conta a historia e devolve o estoque', async ({ page }) => {
  // O estoque e lido ANTES da venda, e a assercao final e "o MESMO numero": o
  // `venda.spec.ts` tambem vende o PRODUTO_E2E e a ordem dos arquivos nao e
  // garantida, entao fixar "20" mediria a suite inteira, nao este cancelamento.
  const [produto] = await consultar<{ id: string; estoque_atual: number }>(
    `select id, estoque_atual from produtos where nome = '${PRODUTO_E2E}'`,
  )
  expect(produto, 'o cenario do global-setup tem de existir').toBeTruthy()

  await venderProdutoE2E(page)
  await abrirDetalheDaVenda(page)

  await page.getByLabel('Motivo do cancelamento').fill('cliente desistiu')
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click()

  // As duas coisas JUNTAS: o recado do `useActionState` fica FORA dos blocos que
  // somem, entao ele e a faixa cinza (que entra no lugar do formulario) tem de
  // aparecer na mesma tela. Era a duvida que a Task 4 deixou em aberto.
  await expect(page.getByTestId('ok')).toContainText('Venda cancelada')
  await expect(page.getByTestId('bloco-cancelada')).toContainText('cliente desistiu')
  await expect(page.getByTestId('status-venda')).toHaveText('Cancelada')

  // Na lista do dia, a MESMA linha agora vem marcada.
  await page.goto('/vendas')
  await expect(
    page.locator('[data-cancelada="1"]').filter({ hasText: PRODUTO_E2E }).first(),
  ).toContainText('Cancelada')
  await expect(page.getByTestId('resumo-canceladas')).toBeVisible()

  // E o estoque voltou — lido na TELA do produto, nao no banco.
  await page.goto(`/produtos/${produto.id}`)
  const blocoEstoque = page
    .locator('dl > div')
    .filter({ has: page.locator('dt', { hasText: /^Estoque$/ }) })
  await expect(blocoEstoque.locator('dd')).toHaveText(String(produto.estoque_atual))
})

test('cancelar sem motivo e recusado e nao muda a venda no banco', async ({ page }) => {
  // Venda NOVA: a do teste anterior ja esta cancelada, e cancelar de novo
  // mediria a regra errada ("Venda ja cancelada" em vez do motivo vazio).
  await venderProdutoE2E(page)
  await abrirDetalheDaVenda(page)

  const vendaId = /\/vendas\/([0-9a-f-]{36})/.exec(page.url())?.[1]
  expect(vendaId, 'o detalhe tem de estar no endereco com o id da venda').toBeTruthy()

  await page.getByLabel('Motivo do cancelamento').fill('')
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click()

  await expect(page.getByTestId('erro')).toContainText('Escreva o motivo do cancelamento.')
  await expect(page.getByTestId('status-venda')).toHaveText('Concluída')

  // "Nada muda no banco": a recusa acontece antes da RPC, entao a venda continua
  // concluida — e nao ha cancelado_em nem motivo gravados.
  const [linha] = await consultar<{ status: string; cancelado_em: string | null }>(
    `select status, cancelado_em from vendas where id = '${vendaId}'`,
  )
  expect(linha.status).toBe('concluida')
  expect(linha.cancelado_em).toBeNull()
})

test('ocultar valores sobrevive a lista e ao detalhe', async ({ page }) => {
  // Venda propria: a lista de hoje nao pode depender do que outro arquivo deixou.
  await venderProdutoE2E(page)

  await page.goto('/vendas?ocultar=1')
  const primeira = page.getByTestId('linha-venda').first()
  await expect(primeira).toContainText('••••')
  await expect(primeira).not.toContainText('R$')

  // O detalhe tem de herdar a marca do endereco, senao abrir a venda mostraria
  // de novo o que o balcao quis esconder.
  await primeira.click()
  await expect(page).toHaveURL(/ocultar=1/)
  await expect(page.getByTestId('itens')).toContainText('••••')
  await expect(page.locator('body')).not.toContainText('R$')
})

test('a venda das 22h de ontem aparece em ONTEM e nao em HOJE', async ({ page }) => {
  // Nao ha como o PDV gravar as 22h de ontem, entao a venda entra direto no
  // banco — como o proprio global-setup faz com o caixa. O teardown apaga as
  // vendas da sessao e2e, entao esta some no fim da suite.
  const [produto] = await consultar<{ id: string }>(
    `select id from produtos where nome = '${PRODUTO_E2E}'`,
  )
  const [sessao] = await consultar<{ id: string }>(
    `select id from caixa_sessoes where terminal = '${TERMINAL_E2E}' and status = 'aberto'`,
  )
  expect(produto, 'o cenario do global-setup tem de existir').toBeTruthy()
  expect(sessao, 'o cenario do global-setup tem de existir').toBeTruthy()

  // O `at time zone 'America/Sao_Paulo'` do fim NAO pode faltar: o timestamp
  // montado e SEM fuso, e o Postgres o interpretaria no fuso do servidor (UTC) —
  // 22:00 UTC e 19:00 em Sao Paulo, que ainda e "ontem", e o teste passaria pelo
  // motivo errado (a data da view e que decide o dia).
  const linhas = await consultar<{ numero: number }>(`
    insert into vendas (chave_idempotencia, caixa_sessao_id, usuario_id, subtotal, total, valor_pago,
                        criado_em)
    values (gen_random_uuid(), '${sessao.id}',
            (select id from perfis where papel = 'dono' order by criado_em limit 1),
            500, 500, 500,
            ((((now() at time zone 'America/Sao_Paulo')::date - 1) + time '22:00')
               at time zone 'America/Sao_Paulo'))
    returning numero
  `)
  const numeroNoturno = linhas[0].numero
  const linhaNoturna = page.getByTestId('linha-venda').filter({ hasText: `Venda ${numeroNoturno} ·` })

  // Em HOJE ela nao pode estar. `numero` e unico, entao o filtro so casa ela.
  await page.goto('/vendas')
  await expect(page.getByRole('heading', { name: 'Vendas — Hoje' })).toBeVisible()
  await expect(linhaNoturna).toHaveCount(0)

  await page.getByTestId('dia-anterior').click()
  await expect(page.getByRole('heading', { name: 'Vendas — Ontem' })).toBeVisible()
  await expect(linhaNoturna).toHaveCount(1)
})
