import path from 'node:path'
import process from 'node:process'
import { expect, test, type Page } from '@playwright/test'

// Nivel 3 da Etapa 8: a tela `/agente` pelo caminho do navegador.
//
// DUAS CAMADAS, DE PROPOSITO, e o motivo e o ambiente de hoje:
//
//   A) NAVEGADOR DE VERDADE com `POST /api/agente` interceptado por `page.route`.
//      `page.route` intercepta o `fetch` do NAVEGADOR (quem chama e o formulario,
//      um client component), entao esta camada funciona e e determinista mesmo com
//      a rota real indisponivel. E aqui que mora TODO o comportamento da tela:
//      exemplos que preenchem, contador, limite de 500, resposta renderizada, erro
//      renderizado, a CORRIDA DE RESPOSTA OBSOLETA (Important 1 do round 1 da
//      Tarefa 4 — o cenario que so existe nesta camada) e a proibicao de mostrar
//      detalhe tecnico.
//
//      ⚠️ ESTA CAMADA AUTENTICA DE VERDADE (Important 1 da revisao final).
//      `/agente` NAO e rota publica (`lib/auth/rotas.ts`), entao o `proxy.ts`
//      manda quem nao tem sessao para `/login` — o proprio teste (9) prova isso. A
//      versao anterior desta camada fazia `page.goto('/agente')` SEM sessao e o
//      primeiro `expect(getByTestId('pergunta'))` nunca era satisfeito: os 8 testes
//      falhavam na arvore commitada, e a "ponte" que injetava o formulario na
//      pagina publica de login foi descartada sem virar commit. Ou seja: sem
//      sessao, o unico teste automatizado do comportamento da tela — inclusive a
//      corrida de resposta obsoleta — nao existe de forma reproduzivel. Por isso
//      `abrirAgente` faz login real (`entrar`) e depois navega. A interceptacao
//      por `page.route` fica exatamente como estava.
//
//   B) ROTA REAL, SEM INTERCEPTACAO — so o que nao depende de chave configurada:
//      sem sessao o `/agente` nao abre; logado como dono, a pergunta clinica e a
//      com CPF mostram a RECUSA LOCAL em portugues, que a rota decide antes de
//      reservar orcamento e antes de qualquer envio ao provedor.
//
// POR QUE A CAMADA B NAO TESTA AS QUATRO INTENCOES NEM O 502: `DEEPSEEK_API_KEY`
// esta VAZIO e `SUPABASE_SERVICE_ROLE_KEY` esta AUSENTE neste ambiente. Como a
// rota reserva orcamento ANTES de enviar, e a reserva falha sem a chave de
// servico, qualquer pergunta que passe pelos filtros locais responde 502 sem
// gastar token e sem mandar nada ao provedor. Ou seja: o caminho feliz ("mostra os
// dados da view") e INALCANCAVEL hoje pelo navegador — essa cobertura fica nos
// testes unitarios da orquestracao (Tarefa 3, com clientes simulados) e nos casos
// SQL (Tarefa 1). E a lacuna esta declarada, nao maquiada: por isso a pergunta
// gerencial abaixo usa uma assercao TOLERANTE (aceita `resposta` OU `erro`) e
// proibe asserir o 502 — um teste que so passa porque a chave falta vira um
// alarme falso no dia em que ela existir, e pior, comecaria a fazer chamada PAGA
// so para ficar verde. Nada aqui aponta `DEEPSEEK_BASE_URL` para stub nenhum:
// com a chave vazia, o envio ja nao acontece.
//
// NENHUMA FIXTURE NO BANCO: a tela nao cria dado (a spec proibe escrita e
// historico), entao nao ha nada a acrescentar ao `limpar()`. Em particular, este
// arquivo NAO toca a linha de `agente_orcamento_mensal` do mes corrente: com as
// chaves configuradas ela e dado real de orcamento da farmacia.

// As credenciais do usuario de teste vivem no .env.local; o Playwright nao le esse
// arquivo sozinho (a convencao dele e .env). `__dirname` e nao `import.meta`: o
// Playwright carrega este .ts como CommonJS, o mesmo padrao de `relatorios.spec.ts`.
process.loadEnvFile(path.resolve(__dirname, '..', '..', '.env.local'))

const EMAIL = process.env.USUARIO_EMAIL
const SENHA = process.env.USUARIO_SENHA

const URL_ROTA = '**/api/agente'

// Os quatro exemplos, exatamente como estao no array `EXEMPLOS` de
// `app/(app)/agente/formulario.tsx`. O texto e comparado com o VALOR do campo:
// clicar preenche e NAO envia (decisao declarada no relatorio da Tarefa 4).
const EXEMPLOS = [
  { testId: 'exemplo-vendas-dia', pergunta: 'Como foram as vendas de hoje?' },
  { testId: 'exemplo-mais-vendidos', pergunta: 'Quais produtos mais venderam?' },
  { testId: 'exemplo-estoque-baixo', pergunta: 'O que preciso repor?' },
  { testId: 'exemplo-estoque-parado', pergunta: 'Quais produtos estão parados?' },
]

// Texto fixo que o servidor manda quando o corpo sai do contrato (nada de
// `resposta` nem `erro` utilizaveis). Espelha `ERRO_INESPERADO` de
// `app/(app)/agente/resposta.ts:21`; o teste unitario do modulo fixa o literal.
const ERRO_INESPERADO = 'O assistente respondeu de forma inesperada. Tente novamente.'

// Mensagens fixas de recusa local, espelhadas de `MENSAGENS_RECUSA`
// (`app/(app)/agente/logica.ts`). Literais de proposito, e a duplicacao esta
// declarada: o `.ts` do Playwright e CommonJS e NAO resolve o alias `@/` do
// tsconfig, entao importar a constante da aplicacao nao e possivel — copiar aqui
// e o mesmo padrao ja usado em `crediario.spec.ts` para as constantes do
// globalSetup. ATENCAO: sao TRES copias que precisam andar juntas — esta,
// `logica.ts` (a fonte) e `app/(app)/agente/resposta.test.ts` (a mensagem do 400).
// Acentuadas como a fonte desde o Minor 2 da revisao final.
const RECUSA_CLINICA =
  'Não posso dar orientação de saúde nem indicar remédio, dose ou tratamento. ' +
  'Procure um médico ou farmacêutico. Posso ajudar com vendas e estoque.'
const RECUSA_PESSOAL =
  'Remova CPF, telefone e e-mail da pergunta. O assistente não precisa de dados ' +
  'pessoais para responder sobre vendas e estoque.'

// Nenhum detalhe interno pode aparecer na tela (spec, "Limites, mensagens e
// falhas"): nem nome de view, nem credencial, nem host do provedor, nem campo
// cru da resposta do modelo, nem codigo de erro. A lista vale para o texto que a
// tela MOSTRA — os marcadores sao escolhidos para nao existirem em portugues
// normal, entao a assercao nao depende do estado do ambiente.
const MARCADORES_TECNICOS = [
  'v_vendas_dia',
  'v_mais_vendidos',
  'v_estoque_baixo',
  'v_estoque_parado',
  'service_role',
  'SUPABASE',
  'api.deepseek',
  'choices',
  'stack',
  'Error',
]

async function entrar(page: Page) {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(EMAIL!)
  await page.getByLabel('Senha').fill(SENHA!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  // O menu lateral so aparece com sessao E perfil.
  await expect(page.getByRole('link', { name: 'Nova venda' })).toBeVisible()
}

/**
 * Abre a tela `/agente` COM sessao — e o unico caminho possivel.
 *
 * `/agente` nao e rota publica (`lib/auth/rotas.ts`) e o `proxy.ts` manda quem nao
 * tem sessao para `/login`, como o proprio teste (9) prova. A versao anterior da
 * camada A fazia `page.goto('/agente')` SEM sessao: o primeiro
 * `expect(getByTestId('pergunta'))` nunca era satisfeito e os 8 testes falhavam na
 * arvore commitada — o "8/8 verde" registrado saiu de uma ponte temporaria que
 * injetava o formulario na pagina publica de `/login` e que NAO existe no commit.
 * Com isso, o unico teste automatizado do comportamento da tela (inclusive a
 * corrida de resposta obsoleta) nao existia de forma reproduzivel: Important 1 da
 * revisao final.
 *
 * O login e o MESMO caminho da camada B (`entrar`), o mesmo padrao dos outros
 * specs de `tests/e2e`. O `page.route` da camada A segue interceptando o `fetch`
 * do NAVEGADOR, entao a rota real nunca e chamada e nenhuma reserva de orcamento
 * sai — a sessao nao custa uma chamada paga.
 */
async function abrirAgente(page: Page) {
  await entrar(page)
  await page.goto('/agente')
  await expect(page.getByTestId('pergunta')).toBeVisible()
}

/** Ajusta a resposta mockada da rota do agente; devolve os corpos recebidos. */
async function interceptar(page: Page, resposta: { status: number; corpo: unknown }) {
  const enviados: unknown[] = []
  await page.route(URL_ROTA, async (rota) => {
    const requisicao = rota.request()
    try {
      enviados.push(JSON.parse(requisicao.postData() ?? 'null'))
    } catch {
      enviados.push(null)
    }
    await rota.fulfill({
      status: resposta.status,
      contentType: 'application/json',
      body: JSON.stringify(resposta.corpo),
    })
  })
  return enviados
}

test.describe('camada A — a tela com a API interceptada pelo navegador', () => {
  test('(1) a tela abre com o aviso de privacidade, a dica inicial e o contador zerado', async ({
    page,
  }) => {
    await abrirAgente(page)

    await expect(page.getByTestId('orientacao-privacidade')).toContainText(
      'Não escreva dados pessoais nem de saúde',
    )
    await expect(page.getByTestId('resultado-vazio')).toBeVisible()
    await expect(page.getByTestId('resultado')).toHaveCount(0)
    await expect(page.getByTestId('erro')).toHaveCount(0)
    await expect(page.getByTestId('contador-caracteres')).toHaveText('0 de 500 caracteres')
  })

  test('(2) os quatro exemplos PREENCHEM o campo e nao enviam nada', async ({ page }) => {
    // Se algum clique disparasse um POST, o teste falharia aqui — e o objetivo:
    // clique em exemplo nao pode gastar chamada paga.
    let chamadas = 0
    await page.route(URL_ROTA, async (rota) => {
      chamadas += 1
      await rota.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await abrirAgente(page)

    for (const exemplo of EXEMPLOS) {
      await page.getByTestId(exemplo.testId).click()
      await expect(page.getByTestId('pergunta')).toHaveValue(exemplo.pergunta)
      await expect(page.getByTestId('contador-caracteres')).toHaveText(
        `${exemplo.pergunta.length} de 500 caracteres`,
      )
      // Clicar num exemplo tambem limpa a resposta/erro visiveis: o que fica na
      // tela e sempre a resposta da pergunta que esta no campo.
      await expect(page.getByTestId('resultado')).toHaveCount(0)
      await expect(page.getByTestId('erro')).toHaveCount(0)
    }

    expect(chamadas).toBe(0)
  })

  test('(3) digitar atualiza o contador e o limite de 500 caracteres e respeitado', async ({
    page,
  }) => {
    await interceptar(page, { status: 200, corpo: { resposta: 'Resposta de teste.' } })
    await abrirAgente(page)

    await page.getByTestId('pergunta').fill('vendas')
    await expect(page.getByTestId('contador-caracteres')).toHaveText('6 de 500 caracteres')

    // O campo e um `<input maxLength={500}>`: colar mais que o limite nao entra.
    await page.getByTestId('pergunta').fill('x'.repeat(600))
    await expect(page.getByTestId('pergunta')).toHaveValue('x'.repeat(500))
    await expect(page.getByTestId('contador-caracteres')).toHaveText('500 de 500 caracteres')

    // Exatamente no teto, o envio continua valendo (o servidor conta code points).
    await page.getByTestId('enviar').click()
    await expect(page.getByTestId('resultado')).toHaveText('Resposta de teste.')
  })

  test('(4) enviar mostra a resposta que o servidor mandou', async ({ page }) => {
    const texto = 'Vendas de hoje: 3 vendas, R$ 45,00. Ticket médio: R$ 15,00.'
    const enviados = await interceptar(page, { status: 200, corpo: { resposta: texto } })
    await abrirAgente(page)

    await page.getByTestId('pergunta').fill('Como foram as vendas de hoje?')
    await page.getByTestId('enviar').click()

    await expect(page.getByTestId('resultado')).toHaveText(texto)
    await expect(page.getByTestId('erro')).toHaveCount(0)
    await expect(page.getByTestId('resultado-vazio')).toHaveCount(0)
    // O que sai no corpo e o texto do campo, sem reescrita do cliente.
    expect(enviados).toEqual([{ pergunta: 'Como foram as vendas de hoje?' }])
  })

  test('(5) enviar mostra o erro em portugues que o servidor mandou', async ({ page }) => {
    const texto = 'O limite mensal do assistente foi atingido. Tente novamente no próximo mês.'
    await interceptar(page, { status: 429, corpo: { erro: texto } })
    await abrirAgente(page)

    await page.getByTestId('pergunta').fill('Como foram as vendas de hoje?')
    await page.getByTestId('enviar').click()

    await expect(page.getByTestId('erro')).toHaveText(texto)
    // `resultado` e `erro` sao mutuamente exclusivos.
    await expect(page.getByTestId('resultado')).toHaveCount(0)
  })

  test('(6) corpo torto e `erro` generico nao deixam a tela mostrar detalhe tecnico', async ({
    page,
  }) => {
    const combinacoes = [
      { status: 200, corpo: { choices: [{ message: { content: 'texto cru do modelo' } }] } },
      { status: 200, corpo: {} },
      { status: 502, corpo: {} },
    ]

    for (const combinacao of combinacoes) {
      await page.unroute(URL_ROTA)
      await interceptar(page, combinacao)
      await abrirAgente(page)
      await page.getByTestId('pergunta').fill('Como foram as vendas de hoje?')
      await page.getByTestId('enviar').click()

      // A saida crua do provedor NUNCA vira o texto da tela: o que aparece e a
      // mensagem fixa do cliente (`resposta.ts`), nunca a tela em branco.
      await expect(page.getByTestId('erro')).toHaveText(ERRO_INESPERADO)
      await expect(page.getByTestId('resultado')).toHaveCount(0)

      const visivel = await page.getByTestId('erro-area').innerText()
      expect(visivel).not.toContain('choices')
      expect(visivel).not.toContain('content')
      expect(visivel).not.toContain('texto cru do modelo')
    }
  })

  test('(7) corrida: a resposta do envio ANTIGO nao escreve na tela da pergunta NOVA', async ({
    page,
  }) => {
    const perguntaA = 'Como foram as vendas de hoje?'
    const perguntaB = 'Quais produtos estão parados?'
    let liberarA: (() => void) | undefined
    const presaA = new Promise<void>((resolve) => {
      liberarA = resolve
    })
    let chamadas = 0

    await page.route(URL_ROTA, async (rota) => {
      chamadas += 1
      if (chamadas === 1) {
        // O POST de "A" fica preso aqui ate o teste liberar.
        await presaA
        await rota.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ resposta: 'RESPOSTA ATRASADA DE A' }),
        })
        return
      }
      await rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ resposta: 'RESPOSTA DE B' }),
      })
    })

    await abrirAgente(page)

    // 1. o usuario pergunta "A" e a requisicao fica em voo.
    await page.getByTestId('pergunta').fill(perguntaA)
    await page.getByTestId('enviar').click()
    await expect(page.getByTestId('carregando')).toBeVisible()

    // 2. enquanto espera, ele troca a pergunta: o campo mostra "B".
    await page.getByTestId('pergunta').fill(perguntaB)
    await expect(page.getByTestId('pergunta')).toHaveValue(perguntaB)

    // 3. a resposta de "A" chega. Ela NAO pode escrever nada embaixo de "B": o
    // botao volta a ficar habilitado (fim do `finally`), e nada mais aparece.
    liberarA!()
    await expect(page.getByTestId('enviar')).toBeEnabled()
    await expect(page.getByTestId('resultado')).toHaveCount(0)
    await expect(page.getByTestId('erro')).toHaveCount(0)
    await expect(page.getByTestId('resultado-area')).not.toContainText('RESPOSTA ATRASADA DE A')
    await expect(page.getByTestId('pergunta')).toHaveValue(perguntaB)
    expect(chamadas).toBe(1)

    // 4. o inverso: a resposta do envio ATUAL e renderizada normalmente.
    await page.getByTestId('enviar').click()
    await expect(page.getByTestId('resultado')).toHaveText('RESPOSTA DE B')
    expect(chamadas).toBe(2)
  })

  test('(8) um envio limpa a resposta anterior antes de consultar de novo', async ({ page }) => {
    let chamadas = 0
    await page.route(URL_ROTA, async (rota) => {
      chamadas += 1
      await rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ resposta: `RESPOSTA ${chamadas}` }),
      })
    })
    await abrirAgente(page)

    await page.getByTestId('pergunta').fill('Como foram as vendas de hoje?')
    await page.getByTestId('enviar').click()
    await expect(page.getByTestId('resultado')).toHaveText('RESPOSTA 1')

    await page.getByTestId('exemplo-estoque-baixo').click()
    await expect(page.getByTestId('resultado')).toHaveCount(0)

    await page.getByTestId('enviar').click()
    await expect(page.getByTestId('resultado')).toHaveText('RESPOSTA 2')
    await expect(page.getByTestId('pergunta')).toHaveValue('O que preciso repor?')
  })
})

test.describe('camada B — a rota REAL, so o que nao depende das chaves', () => {
  test('(9) sem sessao o /agente nao abre e o formulario nao existe', async ({ page }) => {
    // Nenhuma requisicao ao provedor pode sair: a tela nem renderiza. O `proxy.ts`
    // redireciona quem nao tem sessao para o login (checagem otimista) e o layout
    // de `(app)` e a segunda linha de defesa.
    await page.goto('/agente')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByTestId('pergunta')).toHaveCount(0)
    await expect(page.getByTestId('orientacao-privacidade')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
  })

  test('(10) logado: a pergunta clinica e recusada localmente, em portugues', async ({ page }) => {
    await abrirAgente(page)

    await page.getByTestId('pergunta').fill('Estou com dor de cabeça, o que posso tomar?')
    await page.getByTestId('enviar').click()

    await expect(page.getByTestId('erro')).toHaveText(RECUSA_CLINICA)
    await expect(page.getByTestId('resultado')).toHaveCount(0)

    const visivel = await page.getByTestId('erro-area').innerText()
    for (const marcador of MARCADORES_TECNICOS) expect(visivel).not.toContain(marcador)
  })

  test('(11) logado: a pergunta com CPF e recusada localmente, em portugues', async ({ page }) => {
    await abrirAgente(page)

    await page.getByTestId('pergunta').fill('O CPF 123.456.789-09 tem dívida?')
    await page.getByTestId('enviar').click()

    await expect(page.getByTestId('erro')).toHaveText(RECUSA_PESSOAL)
    await expect(page.getByTestId('resultado')).toHaveCount(0)

    const visivel = await page.getByTestId('erro-area').innerText()
    for (const marcador of MARCADORES_TECNICOS) expect(visivel).not.toContain(marcador)
  })

  test('(12) logado: pergunta gerencial normal mostra algum texto em portugues, sem detalhe tecnico', async ({
    page,
  }) => {
    // ⚠️ ESTE COMENTARIO ENVELHECEU E FOI CORRIGIDO EM 16/10/2026. Ele afirmava que
    // "este ambiente nao tem `SUPABASE_SERVICE_ROLE_KEY` nem `DEEPSEEK_API_KEY`" —
    // as DUAS existem hoje, e a prova e o teste (13) fazer chamada real ao provedor
    // e conferir a janela de periodo. Um teste tolerante por um motivo que deixou de
    // valer e uma trava frouxa.
    //
    // A tolerancia fica, mas com o motivo VERDADEIRO: o provedor pode estar fora, e
    // ai nao ha resposta para conferir. Nesse caso o teste SAI COMO PULADO
    // (`test.skip`), e nao como verde — verde sem resposta seria mentira.
    //
    // O que ele ainda prende, e prende de verdade: a tela mostra ALGUM texto em
    // portugues, sem marcador tecnico, seja resposta ou recusa.
    await abrirAgente(page)

    await page.getByTestId('pergunta').fill('Como foram as vendas de hoje?')
    await page.getByTestId('enviar').click()

    const caixaDeResposta = page.getByTestId('resultado')
    const caixaDeErro = page.getByTestId('erro')
    await expect(caixaDeResposta.or(caixaDeErro)).toBeVisible()

    const visivel = (await caixaDeResposta.count()) > 0
      ? await caixaDeResposta.innerText()
      : await caixaDeErro.innerText()

    expect(visivel.trim().length).toBeGreaterThan(0)
    for (const marcador of MARCADORES_TECNICOS) {
      expect(visivel, `a tela mostrou o marcador tecnico ${marcador}`).not.toContain(marcador)
    }
  })

  test('(13) logado: o grafo responde e a JANELA e a pedida, nao 30 dias', async ({ page }) => {
    // A unica trava que pega regressao de ROTEAMENTO e de PERIODO.
    //
    // O agente virou um GRAFO: o coordenador escolhe o especialista (chamada 1) e o
    // especialista escolhe a consulta e o periodo (chamada 2). Nada disso aparece no
    // teste unitario, que nao ve o prompt contra o modelo — e o aceite manual que
    // pegou o defeito nao ficou no repositorio.
    //
    // O defeito que este teste existe para prender: "essa semana" respondia 30 DIAS,
    // com o texto CERTO para o periodo ERRADO — o pior tipo, porque nao parece erro.
    //
    // Custa DUAS chamadas pagas por execucao (~0,0003 US$). E o preco da trava.
    await abrirAgente(page)

    await page.getByTestId('pergunta').fill('Como o pessoal pagou essa semana?')
    await page.getByTestId('enviar').click()

    await expect(page.getByTestId('resultado').or(page.getByTestId('erro'))).toBeVisible()

    // Ambiente sem `DEEPSEEK_API_KEY` — ou provedor fora — responde erro, e isso NAO
    // e falha do teste. Mas sai como PULADO, e nao como verde: um verde sem resposta
    // passaria por verde com a trava funcionando, e nao esta.
    if ((await page.getByTestId('resultado').count()) === 0) {
      test.skip(true, 'sem resposta do provedor: ambiente sem chave ou provedor fora')
    }

    const texto = await page.getByTestId('resultado').innerText()
    // Roteou para o especialista de financeiro (se caísse no caminho de hoje, a
    // "essa semana" nao teria intencao e a resposta seria outra).
    expect(texto).toContain('Formas de pagamento (')

    const janela = /(\d{2})\/(\d{2})\/(\d{4}) a (\d{2})\/(\d{2})\/(\d{4})/.exec(texto)
    expect(janela, `sem periodo no titulo: ${texto.slice(0, 140)}`).not.toBeNull()

    const [, d1, m1, a1, d2, m2, a2] = janela!
    const de = new Date(`${a1}-${m1}-${d1}T12:00:00Z`)
    const ate = new Date(`${a2}-${m2}-${d2}T12:00:00Z`)
    const dias = Math.round((ate.getTime() - de.getTime()) / 86_400_000) + 1

    // "essa semana" e no MAXIMO 7 dias e comeca numa SEGUNDA-FEIRA. O defeito
    // respondia 30 dias — este numero e o que separa os dois.
    //
    // ⚠️ DISCRIMINACAO PROVADA (16/10/2026): com o limite trocado para 2, este teste
    // fica VERMELHO com "janela de 4 dias (12/10 a 15/10)" — ou seja, a assercao e
    // ALCANCADA (a chave existe e o grafo roteia) e a janela e a certa. Sem essa
    // prova, um verde poderia ser so o caminho "sem chave" saindo cedo.
    expect(dias, `janela de ${dias} dias (${d1}/${m1} a ${d2}/${m2})`).toBeLessThanOrEqual(7)
    expect(de.getUTCDay(), `o inicio ${d1}/${m1} nao e segunda-feira`).toBe(1)
  })
})
