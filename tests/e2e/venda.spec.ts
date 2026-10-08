import path from 'node:path'
import process from 'node:process'
import { test, expect, type Page } from '@playwright/test'
// Nivel 3 da spec 12: o que so o navegador prova.
//   - venda inteira SO com teclado (spec 13, Etapa 4);
//   - clique duplo em Finalizar produz UMA venda (idempotencia);
//   - F3 abre a nova venda de outra tela;
//   - crediario acima do limite mostra a mensagem em portugues.
//
// O cenario (produto com estoque e caixa aberto no terminal 'e2e') e preparado
// pelo globalSetup, ANTES da suite: sem ele o PDV recusaria com "Abra o caixa".
//
// As constantes ficam repetidas aqui de proposito. O Playwright carrega este .ts
// como CommonJS, e o globalSetup e .mjs (ESM): um `import` entre os dois falha
// com "Cannot use import statement outside a module". A alternativa seria
// declarar "type": "module" no package.json, o que quebraria next.config.ts e
// eslint.config.mjs. Duas constantes repetidas custam menos que isso.
const PRODUTO_E2E = 'PRODUTO E2E PARACETAMOL'
const PRODUTO_CARO_E2E = 'PRODUTO E2E CARO'
const CLIENTE_E2E = 'CLIENTE E2E LIMITE BAIXO'
// Codigo de barras do PRODUTO_E2E (o mesmo de tests/e2e/global-setup.mjs). O
// teste de teclado busca por ELE: "PRODUTO E2E" casa dois produtos e o
// ArrowDown escolheria o segundo, o que faria o teste medir a ordem da lista.
const CODIGO_E2E = '999000111'
// Nome com virgula: o separador de condicoes do filtro `or` do PostgREST. Antes
// do escape em lib/postgrest.ts, buscar por este termo quebrava a consulta e o
// PDV simplesmente nao achava o produto.
const PRODUTO_VIRGULA_E2E = 'DIPIRONA, 20 COMPRIMIDOS'

// As credenciais do usuario de teste vivem no .env.local; o Playwright nao le
// esse arquivo sozinho (a convencao dele e .env). `__dirname` e nao
// `import.meta`: o Playwright carrega este .ts como CommonJS.
process.loadEnvFile(path.resolve(__dirname, '..', '..', '.env.local'))

const EMAIL = process.env.USUARIO_EMAIL
const SENHA = process.env.USUARIO_SENHA

async function entrar(page: Page) {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(EMAIL!)
  await page.getByLabel('Senha').fill(SENHA!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  // O menu lateral so aparece com sessao E perfil.
  await expect(page.getByRole('link', { name: 'Nova venda' })).toBeVisible()
}

/**
 * Adiciona um produto ao carrinho.
 *
 * Usa a LISTA de resultados em vez de ArrowDown + Enter de proposito: "PRODUTO
 * E2E" casa os DOIS produtos do cenario, e um teste que depende da POSICAO na
 * lista passa a testar a ordem em vez do PDV. O caminho por teclado
 * (setas + Enter) tem teste proprio — "faz uma venda inteira so com o teclado",
 * que busca pelo CODIGO de barras, que casa exatamente um produto.
 */
async function adicionarProduto(page: Page, nome: string) {
  await page.getByLabel('Buscar produto').fill(nome)
  const lista = page.getByTestId('resultados')
  await expect(lista).toBeVisible()
  await lista.locator('li').filter({ hasText: nome }).first().click()
  await expect(page.getByTestId('carrinho')).toContainText(nome)
}

test.beforeEach(async ({ page }) => {
  await entrar(page)
})

test('faz uma venda inteira so com o teclado', async ({ page }) => {
  await page.goto('/vendas/nova')

  // NENHUM clique nesta prova: e o criterio da spec 13 ("venda completa so com
  // teclado"). A busca e pelo CODIGO de barras porque ele casa exatamente um
  // produto — assim o ArrowDown + Enter exercita o caminho de teclado sem
  // depender da ordem da lista, que e o que o adicionarProduto evita.
  await page.getByLabel('Buscar produto').pressSequentially(CODIGO_E2E)
  await expect(page.getByTestId('resultados')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('carrinho')).toContainText(PRODUTO_E2E)

  await page.keyboard.press('F6') // dinheiro, pelo atalho
  // Tab ate o botao "Lancar" e Enter nele: acionar um botao pelo teclado e
  // teclado. Hoje e o unico caminho sem mouse que existe — a tecla do formulario
  // trata as formas de pagamento e o F2, e o botao e type="button" (nao ha
  // submit implicito para o Enter do campo).
  await page.getByLabel('Valor do pagamento').pressSequentially('10,00')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  await page.keyboard.press('F2') // finalizar
  await expect(page.getByTestId('confirmacao')).toContainText('registrada')
  // Venda de R$ 5,00 paga com R$ 10,00: troco de R$ 5,00.
  await expect(page.getByTestId('confirmacao')).toContainText('Troco')
})

test('clique duplo em Finalizar produz uma unica venda', async ({ page }) => {
  await page.goto('/vendas')
  const antes = await page.getByTestId('linha-venda').count()

  await page.goto('/vendas/nova')
  await adicionarProduto(page, PRODUTO_E2E)
  await page.keyboard.press('F6')
  await page.getByLabel('Valor do pagamento').fill('10,00')
  await page.getByRole('button', { name: 'Lançar' }).click()

  // Dois cliques na mesma chave de idempotencia: a segunda chamada devolve a
  // MESMA venda em vez de criar outra.
  await page.getByRole('button', { name: /Finalizar/ }).dblclick()
  await expect(page.getByTestId('confirmacao')).toBeVisible()

  await page.goto('/vendas')
  await expect(page.getByTestId('linha-venda')).toHaveCount(antes + 1)
})

test('desconto ilegivel nao fecha a venda com desconto zero', async ({ page }) => {
  // O `lerDesconto` devolve null quando o texto nao da para ler. Antes esse null
  // era colapsado em zero e a venda fechava com o total cheio — o atendente via
  // um desconto que o sistema nao aplicou.
  await page.goto('/vendas/nova')
  await adicionarProduto(page, PRODUTO_E2E)

  await page.keyboard.press('F6')
  await page.getByLabel('Valor do pagamento').pressSequentially('10,00')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  await page.getByLabel('Desconto (5 ou 5%)').pressSequentially('abc')
  await page.keyboard.press('F2')

  await expect(page.getByTestId('erro')).toContainText('Desconto inválido')
  await expect(page.getByTestId('confirmacao')).toHaveCount(0)
})

test('acha o produto cujo nome tem virgula', async ({ page }) => {
  await page.goto('/vendas/nova')
  await page.getByLabel('Buscar produto').pressSequentially('DIPIRONA, 20')
  await expect(page.getByTestId('resultados')).toContainText(PRODUTO_VIRGULA_E2E)
})

test('a tela de caixa mostra o caixa aberto e lanca uma sangria', async ({ page }) => {
  // A tela de caixa nao existia em nenhuma etapa da spec: sem ela nao se abre nem
  // se fecha o caixa, e sem caixa aberto o PDV recusa vender. Estes dois testes
  // sao a unica prova pelo CAMINHO DO NAVEGADOR — foi por testar por script (que
  // pulava o Server Action) que os limites de corpo e de timeout passaram batido.
  await page.goto('/caixa')
  await expect(page.getByRole('heading', { name: 'Caixa aberto' })).toBeVisible()
  await expect(page.getByText('Esperado na gaveta agora')).toBeVisible()

  await page.getByLabel('Valor do movimento').fill('10,00')
  await page.getByLabel('Motivo do movimento').fill('teste e2e')
  await page.getByRole('button', { name: 'Lançar movimento' }).click()

  await expect(page.getByTestId('ok')).toContainText('Sangria lançada')
  await expect(page.getByText('teste e2e')).toBeVisible()
})

test('fechar o caixa com diferenca e sem observacao e recusado', async ({ page }) => {
  await page.goto('/caixa')
  // O caixa do cenario abriu com 0 e levou uma sangria de 10,00: contar 999,00 da
  // diferenca de sobra, e a spec 8.3 exige observacao para diferenca diferente de
  // zero. A recusa tem de acontecer ANTES da RPC, senao o caixa fecharia.
  await page.getByLabel('Valor contado na gaveta').fill('999,00')
  await page.getByRole('button', { name: 'Fechar caixa' }).click()

  await expect(page.getByTestId('erro')).toContainText('precisa de observação')
  // E o caixa continua aberto.
  await expect(page.getByRole('heading', { name: 'Caixa aberto' })).toBeVisible()
})

test('F3 abre a nova venda a partir de outra tela', async ({ page }) => {
  await page.goto('/produtos')
  await page.keyboard.press('F3')
  await expect(page).toHaveURL(/\/vendas\/nova/)
  await expect(page.getByLabel('Buscar produto')).toBeFocused()
})

test('crediario acima do limite mostra a mensagem em portugues', async ({ page }) => {
  await page.goto('/vendas/nova')
  await adicionarProduto(page, PRODUTO_CARO_E2E)

  // O cliente com limite baixo precisa estar ESCOLHIDO: o crediario exige cliente.
  //
  // Ate a Task 7 isto era `getByLabel(/Cliente/)` + `selectOption(value)`, lendo o
  // VALUE da `<option>` — o texto da opcao muda com o saldo ("— deve R$ 0,00 de
  // R$ 30,00", ou "— sem crediario" quando o limite e zero), entao o caminho
  // estavel era o value. O `<select>` dos 500 primeiros clientes SAIU (quem estava
  // fora do corte nao conseguia comprar no crediario) e o `selectOption` nao existe
  // mais; o cliente agora se escolhe pela busca, como o produto.
  //
  // Setas + Enter de proposito: e o caminho de teclado do campo novo, e aqui ele
  // nao depende da POSICAO da lista como dependeria na busca de produto. O termo
  // pedido e o NOME INTEIRO do cenario (`ilike %termo%`), e o globalSetup apaga os
  // restos antes de criar: a lista traz esse cliente e mais ninguem. Escolher pela
  // lista (como faz o adicionarProduto) seria possivel, mas deixaria o teclado do
  // cliente sem nenhuma prova.
  await page.getByTestId('busca-cliente').pressSequentially(CLIENTE_E2E)
  await expect(page.getByTestId('resultados-cliente')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')

  // O escolhido aparece com nome, limite e saldo: e o que o operador confere antes
  // de fechar no crediario. O limite do cenario e R$ 30,00 e o saldo, zero.
  await expect(page.getByTestId('cliente-escolhido')).toContainText(CLIENTE_E2E)
  await expect(page.getByTestId('cliente-escolhido')).toContainText('R$ 30,00')

  await page.keyboard.press('F10') // crediario
  await page.getByLabel('Valor do pagamento').fill('45,00')
  await page.getByRole('button', { name: 'Lançar' }).click()

  await page.keyboard.press('F2')
  await expect(page.getByTestId('erro')).toContainText('Limite excedido')
})
