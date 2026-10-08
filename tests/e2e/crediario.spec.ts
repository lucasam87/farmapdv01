import path from 'node:path'
import process from 'node:process'
import { test, expect, type Page } from '@playwright/test'
// Nivel 3 da spec 12: o crediario (Etapa 6) pelo caminho do navegador.
//   (1) cadastrar cliente e ve-lo na lista, com o saldo zerado;
//   (2) o dono ve E edita o limite (o caminho do atendente NAO existe neste
//       cenario: o unico usuario do .env.local e dono — a recusa do atendente e
//       provada na suite SQL, `100_clientes.sql` caso 2, e a tela do atendente
//       nem renderiza o campo, ver `clientes/formulario.tsx`);
//   (3) venda no crediario pelo PDV e o saldo na lista de devedores, com o foco
//       de volta na busca de produto (spec 10, "busca sempre focada");
//   (4) recebimento parcial baixa o saldo pelo valor exato;
//   (5) recebimento acima da divida e recusado com a mensagem da RPC, pela PORTA
//       DA LISTA (`/crediario`), e nao grava lancamento nenhum — spec 8.4, nunca
//       gerar saldo credor;
//   (6) o link do WhatsApp leva o 55 e a mensagem pronta com o saldo; cliente sem
//       telefone nao tem link.
//
// O cenario (produtos, `CLIENTE E2E LIMITE BAIXO` e caixa aberto no terminal
// 'e2e') vem do globalSetup. O `Receber` exige caixa aberto, e o cenario abre um.
//
// OS CLIENTES QUE ESTE ARQUIVO CRIA ENTRAM NO `limpar()`: cliente orfao com
// divida fica no banco de PRODUCAO, e a rodada seguinte bateria em 'Já existe um
// cliente com este CPF.' ao cadastrar. O `limpar()` apaga por nome (o teardown, o
// global-setup e este arquivo compartilham os nomes abaixo).
//
// As constantes ficam repetidas aqui de proposito — o mesmo motivo do
// `venda.spec.ts`: o Playwright carrega este .ts como CommonJS e o globalSetup e
// .mjs (ESM), entao um `import` entre os dois falha com "Cannot use import
// statement outside a module".
const CLIENTE_LIMITE_BAIXO = 'CLIENTE E2E LIMITE BAIXO'
const PRODUTO_E2E = 'PRODUTO E2E PARACETAMOL'
// Codigo de barras do PRODUTO_E2E: casa exatamente um produto, entao o caminho
// ArrowDown + Enter nao depende da ORDEM da lista de resultados.
const CODIGO_E2E = '999000111'

// Clientes criados PELA TELA por este arquivo. Cada teste cria o seu em vez de
// depender do que outro deixou no banco: a ordem dos testes e a dos arquivos nao
// e um contrato, e saldo de crediario e estado acumulado.
const CLIENTE_CADASTRO = 'CLIENTE E2E CADASTRO'
const CLIENTE_LIMITE_DONO = 'CLIENTE E2E LIMITE DONO'
const CLIENTE_PARCIAL = 'CLIENTE E2E PARCIAL'
const CLIENTE_ACIMA = 'CLIENTE E2E ACIMA'
const CLIENTE_WHATSAPP = 'CLIENTE E2E WHATSAPP'
const CLIENTE_SEM_TELEFONE = 'CLIENTE E2E SEM TELEFONE'
// CPF do cliente de teste. A base esta com 0 clientes e o `limpar()` apaga este
// por nome a cada rodada; um CPF repetido faria a RPC recusar o cadastro.
const CPF_CADASTRO = '99988877766'

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

type ClienteNovo = {
  nome: string
  telefone?: string
  cpf?: string
  limite?: string
  /** Reais digitados. So o dono ve este campo (spec 5). */
  saldoInicial?: string
}

/** Cadastra um cliente pela TELA (o caminho do balcao, nao um insert). */
async function criarCliente(page: Page, dados: ClienteNovo) {
  await page.goto('/clientes/novo')
  await page.getByLabel('Nome').fill(dados.nome)
  if (dados.telefone) await page.getByLabel('Telefone').fill(dados.telefone)
  if (dados.cpf) await page.getByLabel('CPF').fill(dados.cpf)
  if (dados.limite) await page.getByLabel('Limite de crédito').fill(dados.limite)
  if (dados.saldoInicial) await page.getByLabel('Saldo devedor inicial').fill(dados.saldoInicial)
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByTestId('ok')).toContainText('Cliente salvo.')
}

/**
 * Busca o cliente na lista e abre o detalhe, devolvendo o id do endereco.
 *
 * A busca e pelo NOME INTEIRO (`ilike %termo%`) e os nomes do cenario nao sao
 * substring um do outro, entao a lista traz um cliente e mais ninguem. Sem isso,
 * `saldo-cliente` (que existe em CADA linha) cairia no strict mode do Playwright.
 */
async function abrirCliente(page: Page, nome: string): Promise<string> {
  await page.goto('/clientes')
  await page.getByTestId('busca-cliente').fill(nome)
  await page.getByRole('button', { name: 'Buscar' }).click()

  const linha = page.getByTestId('linha-cliente').filter({ hasText: nome })
  await expect(linha).toHaveCount(1)
  await linha.getByRole('link', { name: nome }).click()
  await expect(page.getByRole('heading', { name: nome })).toBeVisible()

  const id = /\/clientes\/([0-9a-f-]{36})/.exec(page.url())?.[1]
  expect(id, 'o detalhe tem de estar no endereco com o id do cliente').toBeTruthy()
  return id!
}

/**
 * Recebe um valor pelo formulario de UM cliente. O `data-testid` do formulario
 * leva o id (`receber-<cliente_id>`, Task 4) porque a lista de devedores embute o
 * mesmo componente em varias linhas — sem escopar, `Valor recebido` seria
 * ambiguo.
 */
function formularioReceber(page: Page, clienteId: string) {
  return page.getByTestId(`receber-${clienteId}`)
}

/** A secao do extrato do detalhe (a tabela de lancamentos do crediario). */
function extrato(page: Page) {
  return page.locator('section').filter({ hasText: 'Extrato do crediário' })
}

/** Abre `/crediario` ja filtrado por um nome, para o total ser SO dele. */
async function abrirCrediarioDo(page: Page, nome: string) {
  await page.goto('/crediario')
  await page.getByTestId('busca-devedor').fill(nome)
  await page.getByRole('button', { name: 'Buscar' }).click()
}

test.beforeEach(async ({ page }) => {
  await entrar(page)
})

test('(1) cadastra o cliente e ele aparece na lista com o saldo zerado', async ({ page }) => {
  await criarCliente(page, {
    nome: CLIENTE_CADASTRO,
    telefone: '11987654321',
    cpf: CPF_CADASTRO,
    limite: '50,00',
  })

  await page.goto('/clientes')
  await page.getByTestId('busca-cliente').fill(CLIENTE_CADASTRO)
  await page.getByRole('button', { name: 'Buscar' }).click()

  // O testid `saldo-cliente` se repete em CADA linha: quem localiza e a linha.
  const linha = page.getByTestId('linha-cliente').filter({ hasText: CLIENTE_CADASTRO })
  await expect(linha).toHaveCount(1)
  await expect(linha.getByTestId('saldo-cliente')).toHaveText('R$ 0,00')
  await expect(linha).toContainText('(11) 98765-4321')
  await expect(linha).toContainText(CPF_CADASTRO)
  // O limite que o dono digitou volta formatado em reais (e nao 100x menor: o
  // cadastro le "50,00" pelo parser do projeto e grava 5000 centavos).
  await expect(linha).toContainText('R$ 50,00')
})

test('(2) o dono ve e edita o limite de credito', async ({ page }) => {
  await page.goto('/clientes/novo')
  // Os tres campos de dono, juntos. Sem o dono eles nao existem e a tela diz
  // "Limite e bloqueio sao do dono." — o cenario e2e so tem dono (ver o cabecalho).
  await expect(page.getByLabel('Limite de crédito')).toBeVisible()
  await expect(page.getByLabel('Saldo devedor inicial')).toBeVisible()
  await expect(page.getByText('Zero significa que o cliente não faz crediário.')).toBeVisible()
  await expect(page.getByText('Limite e bloqueio são do dono.')).toHaveCount(0)

  await page.getByLabel('Nome').fill(CLIENTE_LIMITE_DONO)
  await page.getByLabel('Limite de crédito').fill('45,00')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByTestId('ok')).toContainText('Cliente salvo.')

  // O limite sobrevive a ida ao banco E volta no formulario de edicao: e o que o
  // dono confere antes de liberar credito para alguem.
  await abrirCliente(page, CLIENTE_LIMITE_DONO)
  await expect(page.getByText('Limite de crédito: R$ 45,00')).toBeVisible()
  await expect(page.getByTestId('saldo-cliente')).toHaveText('R$ 0,00')

  await page.getByRole('link', { name: 'Editar' }).click()
  await expect(page.getByLabel('Limite de crédito')).toHaveValue('45,00')
  await expect(page.getByText('Limite e bloqueio são do dono.')).toHaveCount(0)
})

test('(3) a venda no crediario aparece na lista de devedores', async ({ page }) => {
  await page.goto('/vendas/nova')

  // O cliente pela BUSCA (o `<select>` dos 500 primeiros saiu na Task 7): o nome
  // inteiro casa so ele, entao ArrowDown + Enter nao depende da ordem da lista.
  await page.getByTestId('busca-cliente').pressSequentially(CLIENTE_LIMITE_BAIXO)
  await expect(page.getByTestId('resultados-cliente')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('cliente-escolhido')).toContainText(CLIENTE_LIMITE_BAIXO)
  await expect(page.getByTestId('cliente-escolhido')).toContainText('R$ 30,00')

  // Spec 10, "busca sempre focada": o proximo bipe do leitor tem de virar
  // PRODUTO. Sem esta assercao, escolher o cliente e deixar o foco no campo do
  // cliente passava despercebido (ruling da Task 7).
  await expect(page.getByLabel('Buscar produto')).toBeFocused()

  await page.getByLabel('Buscar produto').pressSequentially(CODIGO_E2E)
  await expect(page.getByTestId('resultados')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('carrinho')).toContainText(PRODUTO_E2E)

  await page.keyboard.press('F10') // crediario
  await page.getByLabel('Valor do pagamento').fill('5,00')
  await page.getByRole('button', { name: 'Lançar' }).click()
  // A forma do pagamento lancado: e o crediario, e nao o dinheiro do F6.
  await expect(page.getByTestId('pdv')).toContainText('crediario: R$ 5,00')

  await page.keyboard.press('F2')
  await expect(page.getByTestId('confirmacao')).toContainText('registrada')
  await expect(page.getByTestId('confirmacao')).toContainText('R$ 5,00')

  // A lista de devedores le a MESMA view que o PDV: o filtro pelo nome deixa o
  // total a receber sendo SO deste cliente (a soma da farmacia inteira mediria a
  // producao, nao a venda que este teste acabou de fazer).
  await abrirCrediarioDo(page, CLIENTE_LIMITE_BAIXO)
  await expect(page.getByTestId('total-a-receber')).toHaveText('R$ 5,00')
  const linha = page.getByTestId('linha-devedor').filter({ hasText: CLIENTE_LIMITE_BAIXO })
  await expect(linha).toHaveCount(1)
  await expect(linha).toContainText('R$ 5,00')
})

test('(4) o recebimento parcial baixa o saldo pelo valor exato', async ({ page }) => {
  // A divida de R$ 30,00 nasce do SALDO INICIAL (o caminho do dono na tela), e
  // nao de uma venda: o teste mede o RECEBIMENTO, e a venda no crediario tem o
  // teste (3). Assim o valor de partida e exato e nao depende de outra tela.
  await criarCliente(page, { nome: CLIENTE_PARCIAL, saldoInicial: '30,00' })

  const id = await abrirCliente(page, CLIENTE_PARCIAL)
  await expect(page.getByTestId('saldo-cliente')).toHaveText('R$ 30,00')
  await expect(extrato(page).locator('tbody tr')).toHaveCount(1)

  await formularioReceber(page, id).getByLabel('Valor recebido').fill('10,00')
  await formularioReceber(page, id).getByRole('button', { name: /^Receber de / }).click()

  await expect(formularioReceber(page, id).getByTestId('ok')).toContainText('Recebimento registrado.')
  // Sem recarregar: `receberDoCliente` revalida a rota e o saldo tem de aparecer
  // sozinho — se o operador precisasse apertar F5 para ver a divida cair, a tela
  // estaria mentindo sobre o que acabou de acontecer.
  await expect(page.getByTestId('saldo-cliente')).toHaveText('R$ 20,00')
  // O recebimento e um SEGUNDO lancamento no extrato: nao sobrescreveu o saldo.
  await expect(extrato(page).locator('tbody tr')).toHaveCount(2)
  await expect(extrato(page)).toContainText('- R$ 10,00')

  // E a lista de devedores le a mesma view.
  await abrirCrediarioDo(page, CLIENTE_PARCIAL)
  await expect(page.getByTestId('total-a-receber')).toHaveText('R$ 20,00')
  await expect(
    page.getByTestId('linha-devedor').filter({ hasText: CLIENTE_PARCIAL }),
  ).toContainText('R$ 20,00')
})

test('(5) receber acima da divida e recusado e nao vira credito', async ({ page }) => {
  await criarCliente(page, { nome: CLIENTE_ACIMA, saldoInicial: '10,00' })
  const id = await abrirCliente(page, CLIENTE_ACIMA)
  await expect(page.getByTestId('saldo-cliente')).toHaveText('R$ 10,00')

  // Pela PORTA DA LISTA de devedores, e nao pelo detalhe: o mesmo formulario e
  // embutido em cada linha (`receber-<cliente_id>`), e o valor ja vem focado na
  // primeira linha — e o pedido da Task 5 para o balcao.
  await abrirCrediarioDo(page, CLIENTE_ACIMA)
  const formulario = formularioReceber(page, id)
  await expect(formulario.getByLabel('Valor recebido')).toBeFocused()
  await formulario.getByLabel('Valor recebido').fill('20,00')
  await formulario.getByRole('button', { name: /^Receber de / }).click()

  // A mensagem e a da RPC 014 (spec 9), com o valor da divida em reais: um
  // recebimento de 20,00 lido como 2000 centavos diria "R$ 10,00" aqui, e um
  // leitor com fator 100 errado diria "R$ 1.000,00".
  await expect(formulario.getByTestId('erro')).toContainText(
    'O valor é maior que a dívida (R$ 10,00).',
  )

  // NADA foi gravado: a divida continua a mesma e o extrato tem so o saldo
  // inicial. Saldo credor e proibido (spec 8.4) — e a tela tem de concordar.
  await abrirCliente(page, CLIENTE_ACIMA)
  await expect(page.getByTestId('saldo-cliente')).toHaveText('R$ 10,00')
  await expect(extrato(page).locator('tbody tr')).toHaveCount(1)

  await abrirCrediarioDo(page, CLIENTE_ACIMA)
  await expect(page.getByTestId('total-a-receber')).toHaveText('R$ 10,00')
})

test('(6) o link do WhatsApp leva o numero com 55 e a mensagem com o saldo', async ({ page }) => {
  // O sistema so ABRE o `wa.me` com a mensagem pronta; quem envia e o operador
  // (spec 8.4). Nada aqui clica no link (isso abriria o WhatsApp de verdade):
  // o que da para provar no navegador e o ENDERECO montado e que carregar a tela
  // nao abre conversa nenhuma sozinho.
  let abriuPopup = false
  page.on('popup', () => {
    abriuPopup = true
  })

  await criarCliente(page, {
    nome: CLIENTE_WHATSAPP,
    telefone: '11912345678',
    saldoInicial: '15,00',
  })
  await abrirCliente(page, CLIENTE_WHATSAPP)

  const link = page.getByRole('link', { name: `Cobrar ${CLIENTE_WHATSAPP} no WhatsApp` })
  await expect(link).toBeVisible()
  const href = (await link.getAttribute('href')) ?? ''
  expect(href).toContain('https://wa.me/5511912345678?text=')
  const mensagem = decodeURIComponent(href.split('?text=')[1] ?? '')
  expect(mensagem).toContain(`Olá, ${CLIENTE_WHATSAPP}!`)
  expect(mensagem).toContain('Seu saldo na farmácia é R$ 15,00.')
  expect(abriuPopup, 'a tela nao pode abrir o WhatsApp sozinha').toBe(false)

  // Sem telefone nao ha link — e a tela DIZ isso, em vez de oferecer um botao que
  // abriria uma conversa sem destinatario.
  await criarCliente(page, { nome: CLIENTE_SEM_TELEFONE })
  await abrirCliente(page, CLIENTE_SEM_TELEFONE)
  await expect(page.getByText('Cliente sem telefone cadastrado.')).toBeVisible()
  await expect(page.locator('a[href^="https://wa.me/"]')).toHaveCount(0)
})
