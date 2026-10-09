import path from 'node:path'
import process from 'node:process'
import { expect, test, type Page } from '@playwright/test'

// O produto de R$ 5,00 e o caixa aberto no terminal `e2e` sao preparados pelo
// globalSetup. O teardown remove vendas, produto e caixa depois de toda a suite.
const PRODUTO_E2E = 'PRODUTO E2E PARACETAMOL'
const CODIGO_E2E = '999000111'

// Playwright carrega este arquivo como CommonJS; usamos o mesmo padrao dos
// demais testes para ler as credenciais do .env.local.
process.loadEnvFile(path.resolve(__dirname, '..', '..', '.env.local'))

const EMAIL = process.env.USUARIO_EMAIL
const SENHA = process.env.USUARIO_SENHA

async function entrar(page: Page) {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(EMAIL!)
  await page.getByLabel('Senha').fill(SENHA!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('link', { name: 'Nova venda' })).toBeVisible()
}

function hojeEmSaoPaulo() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function diaAnterior(dia: string) {
  const [ano, mes, diaDoMes] = dia.split('-').map(Number)
  return new Date(Date.UTC(ano, mes - 1, diaDoMes - 1)).toISOString().slice(0, 10)
}

function centavos(texto: string) {
  return Number(texto.replace(/\D/g, ''))
}

async function faturamento(page: Page) {
  const texto = await page.getByTestId('card-faturamento').locator('p').nth(1).innerText()
  return centavos(texto)
}

test.beforeEach(async ({ page }) => {
  await entrar(page)
})

test('(1) abre hoje com os quatro cartoes e as duas listas', async ({ page }) => {
  await page.goto('/relatorios')

  const hoje = hojeEmSaoPaulo()
  await expect(page.getByTestId('periodo-de')).toHaveValue(hoje)
  await expect(page.getByTestId('periodo-ate')).toHaveValue(hoje)

  for (const testId of ['card-faturamento', 'card-vendas', 'card-ticket', 'card-lucro']) {
    await expect(page.getByTestId(testId)).toBeVisible()
  }
  await expect(page.getByTestId('formas-pagamento')).toBeVisible()
  await expect(page.getByTestId('mais-vendidos')).toBeVisible()
})

test('(2) a venda de R$ 5,00 no PDV aumenta o faturamento de hoje e entra no ranking', async ({
  page,
}) => {
  await page.goto('/relatorios')
  const hoje = hojeEmSaoPaulo()
  const antes = await faturamento(page)

  await page.goto('/vendas/nova')
  await page.getByLabel('Buscar produto').fill(CODIGO_E2E)
  const resultados = page.getByTestId('resultados')
  await expect(resultados).toBeVisible()
  await resultados.locator('li').filter({ hasText: PRODUTO_E2E }).click()
  await expect(page.getByTestId('carrinho')).toContainText(PRODUTO_E2E)

  await page.keyboard.press('F6')
  await page.getByLabel('Valor do pagamento').fill('5,00')
  await page.getByRole('button', { name: 'Lançar' }).click()
  await page.keyboard.press('F2')
  await expect(page.getByTestId('confirmacao')).toContainText('registrada')
  await expect(page.getByTestId('confirmacao')).toContainText('R$ 5,00')

  await page.goto(`/relatorios?de=${hoje}&ate=${hoje}`)
  await expect(page.getByTestId('card-faturamento')).toBeVisible()
  expect(await faturamento(page)).toBe(antes + 500)
  await expect(
    page.getByTestId('mais-vendidos').getByTestId('linha-vendido').filter({ hasText: PRODUTO_E2E }),
  ).toBeVisible()
})

test('(3) periodo invalido avisa e mantem os cartoes', async ({ page }) => {
  await page.goto('/relatorios?de=2026-02-31&ate=2026-02-31')

  await expect(page.getByTestId('aviso-periodo')).toBeVisible()
  for (const testId of ['card-faturamento', 'card-vendas', 'card-ticket', 'card-lucro']) {
    await expect(page.getByTestId(testId)).toBeVisible()
  }
})

test('(4) o atalho Ontem atualiza o endereco e mostra o faturamento de ontem', async ({ page }) => {
  await page.goto('/relatorios')
  const ontem = diaAnterior(hojeEmSaoPaulo())

  await page.getByTestId('periodo-ontem').click()
  await expect(page).toHaveURL(new RegExp(`/relatorios\\?de=${ontem}&ate=${ontem}$`))
  await expect(page.getByTestId('periodo-de')).toHaveValue(ontem)
  await expect(page.getByTestId('periodo-ate')).toHaveValue(ontem)
  // `historico.spec.ts` insere uma venda de R$ 5,00 em ontem no mesmo cenário
  // e o globalTeardown só a remove ao fim da suíte. O número prova o filtro do
  // período e coincide com essa venda conhecida.
  await expect(page.getByTestId('card-faturamento').locator('p').nth(1)).toHaveText('R$ 5,00')
})
