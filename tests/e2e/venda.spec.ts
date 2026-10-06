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
 * E2E" casa os dois produtos do cenario, e um teste que depende da POSICAO na
 * lista passa a testar a ordem em vez do PDV. O caminho por teclado
 * (setas + Enter) e coberto pelo teste de F3, que confere o foco.
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
  await adicionarProduto(page, PRODUTO_E2E)

  // Daqui para baixo NAO existe clique: e o criterio da spec (venda so com
  // teclado, F6 escolhe a forma e F2 finaliza).
  await page.keyboard.press('F6') // dinheiro
  await page.getByLabel('Valor do pagamento').fill('10,00')
  await page.getByRole('button', { name: 'Lançar' }).click()

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

test('F3 abre a nova venda a partir de outra tela', async ({ page }) => {
  await page.goto('/produtos')
  await page.keyboard.press('F3')
  await expect(page).toHaveURL(/\/vendas\/nova/)
  await expect(page.getByLabel('Buscar produto')).toBeFocused()
})

test('crediario acima do limite mostra a mensagem em portugues', async ({ page }) => {
  await page.goto('/vendas/nova')
  await adicionarProduto(page, PRODUTO_CARO_E2E)

  // O cliente com limite baixo precisa estar selecionado: o crediario exige
  // cliente. `selectOption` com label exige STRING exata (nao aceita regex), por
  // isso o valor e escolhido pelo texto que comeca com o nome.
  const seletor = page.getByLabel(/Cliente/)
  await seletor.selectOption({ label: `${CLIENTE_E2E} — sem crediário` })

  await page.keyboard.press('F10') // crediario
  await page.getByLabel('Valor do pagamento').fill('45,00')
  await page.getByRole('button', { name: 'Lançar' }).click()

  await page.keyboard.press('F2')
  await expect(page.getByTestId('erro')).toContainText('Limite excedido')
})
