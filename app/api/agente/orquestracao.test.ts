import { describe, it, expect } from 'vitest'
import {
  processarPergunta,
  custoDaChamada,
  type Deps,
  type Entrada,
  type FiltroConsulta,
  type IntencaoConsulta,
  type ResultadoClassificacao,
  type ResultadoConsulta,
  type ResultadoReserva,
} from './orquestracao'
import {
  LIMITE_PERGUNTA,
  LIMITE_RESULTADOS,
  MAX_TOKENS_SAIDA,
  RESERVA_MICROS,
  TOKENS_ENTRADA_RESERVA,
  custoMicros,
  mensagemRecusa,
} from '@/app/(app)/agente/logica'

// A orquestracao e TODA a decisao da rota `POST /api/agente`: quem entra, o que
// e recusado sem gastar, quanto se reserva, o que o modelo pode devolver e qual
// view pode ser lida. Nenhum caso aqui toca rede, banco ou dinheiro: as seis
// dependencias entram simuladas e cada uma registra como foi chamada.
//
// O que estes testes existem para impedir, em ordem de gravidade:
//   1. gastar (provedor ou ledger) antes de saber que a pergunta pode sair;
//   2. creditar o mes com um `usage` torto (micros negativo devolve saldo);
//   3. mandar o usuario ler texto cru do modelo em vez da resposta montada;
//   4. consultar a view errada, ou cortar o periodo de vendas em 10 linhas.

const AGORA = new Date('2026-10-09T14:00:00-03:00')
const MES = '2026-10-01'
const HOJE = '2026-10-09'
const PERFIL = { id: 'perfil-1', nome: 'Ana', papel: 'dono' } as const
const CLASSIFICACAO_PADRAO: ResultadoClassificacao = {
  ok: true,
  conteudo: '{"intencao":"vendas_dia"}',
  uso: { prompt_tokens: 400, completion_tokens: 40 },
}

type Chamadas = {
  classificar: string[]
  reservar: { mes: string; micros: number }[]
  reconciliar: { id: string; micros: number }[]
  liberar: string[]
  consultar: { intencao: IntencaoConsulta; filtro: FiltroConsulta; limite: number | null }[]
}

type Opcoes = {
  classificacao?: ResultadoClassificacao
  classificarLanca?: boolean
  reserva?: ResultadoReserva
  reservaLanca?: boolean
  leitura?: ResultadoConsulta
  leituraLanca?: boolean
  liberarLanca?: boolean
  reconciliarLanca?: boolean
}

/** As seis dependencias do R17, todas simuladas, cada uma registrando a chamada. */
function montarDeps(opcoes: Opcoes = {}): { deps: Deps; chamadas: Chamadas } {
  const chamadas: Chamadas = {
    classificar: [],
    reservar: [],
    reconciliar: [],
    liberar: [],
    consultar: [],
  }

  const deps: Deps = {
    agora: () => AGORA,
    async classificar(pergunta) {
      chamadas.classificar.push(pergunta)
      if (opcoes.classificarLanca) throw new Error('transporte caiu')
      return opcoes.classificacao ?? CLASSIFICACAO_PADRAO
    },
    async reservar(mes, micros) {
      chamadas.reservar.push({ mes, micros })
      if (opcoes.reservaLanca) throw new Error('ledger fora do ar')
      return opcoes.reserva ?? { ok: true, id: 'reserva-1' }
    },
    async reconciliar(id, micros) {
      chamadas.reconciliar.push({ id, micros })
      if (opcoes.reconciliarLanca) throw new Error('reconciliacao falhou')
    },
    async liberar(id) {
      chamadas.liberar.push(id)
      if (opcoes.liberarLanca) throw new Error('liberacao falhou')
    },
    async consultar(intencao, filtro, limite) {
      chamadas.consultar.push({ intencao, filtro, limite })
      if (opcoes.leituraLanca) throw new Error('postgrest estourou')
      return opcoes.leitura ?? { ok: true, linhas: [] }
    },
  }

  return { deps, chamadas }
}

function entrada(pergunta: unknown, perfil: Entrada['perfil'] = PERFIL): Entrada {
  return { sessao: true, perfil, pergunta }
}

function nadaFoiChamado(chamadas: Chamadas): boolean {
  return (
    chamadas.classificar.length === 0 &&
    chamadas.reservar.length === 0 &&
    chamadas.reconciliar.length === 0 &&
    chamadas.liberar.length === 0 &&
    chamadas.consultar.length === 0
  )
}

// ============================================================
// 1. Sessao e perfil — ANTES de qualquer custo externo.
// ============================================================

describe('sessao e perfil vem antes de qualquer custo', () => {
  it('sem sessao devolve 401 e nao toca em orcamento nem provedor', async () => {
    const { deps, chamadas } = montarDeps()
    const resposta = await processarPergunta(
      { sessao: false, perfil: null, pergunta: 'Como foram as vendas de hoje?' },
      deps,
    )

    expect(resposta.status).toBe(401)
    // O texto e fixado de proposito (revisao final): a MESMA mensagem responde ao
    // usuario deslogado e a excecao de Auth/`cookies()` que a rota trata como
    // "sem sessao" (Minor 1), entao ela nao pode afirmar que ele esta deslogado.
    expect(resposta.corpo).toEqual({
      erro: 'Não foi possível confirmar sua sessão. Entre novamente.',
    })
    expect(nadaFoiChamado(chamadas)).toBe(true)
  })

  it('sessao sem perfil ativo devolve 403 e nao toca em nada', async () => {
    const { deps, chamadas } = montarDeps()
    const resposta = await processarPergunta(entrada('Como foram as vendas?', null), deps)

    expect(resposta.status).toBe(403)
    expect(nadaFoiChamado(chamadas)).toBe(true)
  })

  it('papel fora de dono/atendente devolve 403', async () => {
    const { deps, chamadas } = montarDeps()
    const perfilInvalido = { id: 'x', nome: 'X', papel: 'convidado' } as unknown as Entrada['perfil']
    const resposta = await processarPergunta(entrada('Como foram as vendas?', perfilInvalido), deps)

    expect(resposta.status).toBe(403)
    expect(nadaFoiChamado(chamadas)).toBe(true)
  })

  it('dono e atendente passam pelo portao', async () => {
    for (const papel of ['dono', 'atendente'] as const) {
      const { deps, chamadas } = montarDeps()
      const perfil = { id: 'perfil-1', nome: 'Ana', papel }
      const resposta = await processarPergunta(entrada('Como foram as vendas de hoje?', perfil), deps)

      expect(resposta.status).toBe(200)
      expect(chamadas.reservar).toHaveLength(1)
    }
  })
})

// ============================================================
// 2. Recusa local — nada de reserva, nada de provedor.
// ============================================================

describe('recusa local nao reserva nem chama o provedor', () => {
  it('pergunta clinica recusa com a mensagem de saude', async () => {
    const { deps, chamadas } = montarDeps()
    const resposta = await processarPergunta(entrada('Qual a dosagem de amoxicilina para um adulto?'), deps)

    expect(resposta).toEqual({ status: 400, corpo: { erro: mensagemRecusa('clinica') } })
    expect(nadaFoiChamado(chamadas)).toBe(true)
  })

  it('CPF, telefone e e-mail recusam sem sair do servidor', async () => {
    const perguntas = [
      'O cliente 123.456.789-00 comprou quanto?',
      'Liga para (11) 98765-4321 e pergunta',
      'Quem tem o e-mail cliente@exemplo.com no cadastro?',
    ]

    for (const pergunta of perguntas) {
      const { deps, chamadas } = montarDeps()
      const resposta = await processarPergunta(entrada(pergunta), deps)

      expect(resposta).toEqual({ status: 400, corpo: { erro: mensagemRecusa('pessoal') } })
      expect(nadaFoiChamado(chamadas)).toBe(true)
    }
  })

  it('pergunta vazia, ausente ou de outro tipo recusa sem sair do servidor', async () => {
    for (const pergunta of ['', '   ', undefined, 42, null, {}, []]) {
      const { deps, chamadas } = montarDeps()
      const resposta = await processarPergunta(entrada(pergunta), deps)

      expect(resposta).toEqual({ status: 400, corpo: { erro: mensagemRecusa('vazia') } })
      expect(nadaFoiChamado(chamadas)).toBe(true)
    }
  })

  it('pergunta acima de 500 caracteres recusa sem sair do servidor', async () => {
    const { deps, chamadas } = montarDeps()
    const resposta = await processarPergunta(entrada('a'.repeat(LIMITE_PERGUNTA + 1)), deps)

    expect(resposta).toEqual({ status: 400, corpo: { erro: mensagemRecusa('longa') } })
    expect(nadaFoiChamado(chamadas)).toBe(true)
  })

  it('pergunta gerencial legitima no pior tamanho possivel segue para o provedor', async () => {
    // 500 code points de 4 bytes UTF-8 cada: o pior caso do limite de caracteres.
    const pergunta = '😀'.repeat(LIMITE_PERGUNTA)
    const { deps, chamadas } = montarDeps()
    const resposta = await processarPergunta(entrada(pergunta), deps)

    expect(resposta.status).toBe(200)
    expect(chamadas.classificar).toEqual([pergunta])
  })
})

// ============================================================
// 3. Orcamento — reserva, reconciliacao, liberacao e retencao.
// ============================================================

describe('orcamento', () => {
  it('reserva o mes de Sao Paulo e os 1373 micros ANTES de chamar o provedor', async () => {
    const { deps, chamadas } = montarDeps()
    await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

    expect(chamadas.reservar).toEqual([{ mes: MES, micros: RESERVA_MICROS }])
    expect(RESERVA_MICROS).toBe(1373)
    expect(chamadas.classificar).toHaveLength(1)
  })

  it('orcamento esgotado devolve 429 sem chamar o provedor', async () => {
    const { deps, chamadas } = montarDeps({ reserva: { ok: false, motivo: 'esgotado' } })
    const resposta = await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

    expect(resposta.status).toBe(429)
    expect(resposta.corpo).toEqual({ erro: expect.any(String) })
    expect(chamadas.classificar).toHaveLength(0)
    expect(chamadas.consultar).toHaveLength(0)
    expect(chamadas.reconciliar).toHaveLength(0)
    expect(chamadas.liberar).toHaveLength(0)
  })

  it('falha do ledger devolve 502 e nao chama o provedor', async () => {
    for (const opcoes of [
      { reserva: { ok: false, motivo: 'falha' } as ResultadoReserva },
      { reservaLanca: true },
    ]) {
      const { deps, chamadas } = montarDeps(opcoes)
      const resposta = await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

      expect(resposta.status).toBe(502)
      expect(chamadas.classificar).toHaveLength(0)
      expect(chamadas.consultar).toHaveLength(0)
    }
  })

  it('falha comprovadamente PRE-ENVIO libera a reserva', async () => {
    const { deps, chamadas } = montarDeps({
      classificacao: { ok: false, fase: 'pre_envio' },
    })
    const resposta = await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

    expect(resposta.status).toBe(502)
    expect(chamadas.liberar).toEqual(['reserva-1'])
    expect(chamadas.reconciliar).toHaveLength(0)
  })

  it('falha AMBIGUA mantem a reserva consumida (nem libera, nem reconcilia)', async () => {
    const { deps, chamadas } = montarDeps({
      classificacao: { ok: false, fase: 'ambigua' },
    })
    const resposta = await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

    expect(resposta.status).toBe(502)
    expect(chamadas.liberar).toHaveLength(0)
    expect(chamadas.reconciliar).toHaveLength(0)
  })

  it('classificar que LANCA e tratado como falha ambigua: mantem a reserva', async () => {
    const { deps, chamadas } = montarDeps({ classificarLanca: true })
    const resposta = await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

    expect(resposta.status).toBe(502)
    expect(chamadas.liberar).toHaveLength(0)
    expect(chamadas.reconciliar).toHaveLength(0)
  })

  it('sucesso com usage reconcilia pelo custo real das tarifas de pico', async () => {
    const uso = { prompt_tokens: 812, completion_tokens: 37 }
    const { deps, chamadas } = montarDeps({
      classificacao: { ok: true, conteudo: '{"intencao":"vendas_dia"}', uso },
    })
    await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

    expect(chamadas.reconciliar).toEqual([{ id: 'reserva-1', micros: custoMicros(uso) }])
    expect(chamadas.reconciliar[0]!.micros).toBe(Math.ceil((812 * 300_000 + 37 * 1_200_000) / 1_000_000))
  })

  it('sucesso SEM usage mantem a reserva (custo desconhecido)', async () => {
    const { deps, chamadas } = montarDeps({
      classificacao: { ok: true, conteudo: '{"intencao":"vendas_dia"}', uso: null },
    })
    const resposta = await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

    expect(resposta.status).toBe(200)
    expect(chamadas.reconciliar).toHaveLength(0)
    expect(chamadas.liberar).toHaveLength(0)
  })

  it('conteudo VAZIO ainda reconcilia o usage: os tokens foram gastos', async () => {
    const uso = { prompt_tokens: 500, completion_tokens: 0 }
    const { deps, chamadas } = montarDeps({
      classificacao: { ok: true, conteudo: '', uso },
    })
    const resposta = await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

    expect(resposta.status).toBe(400)
    expect(chamadas.reconciliar).toEqual([{ id: 'reserva-1', micros: custoMicros(uso) }])
    expect(chamadas.consultar).toHaveLength(0)
  })

  it('usage torto NAO reconcilia (um micros negativo creditaria o mes)', async () => {
    const usos = [
      { prompt_tokens: '500', completion_tokens: 10 },
      { prompt_tokens: 500, completion_tokens: -10 },
      { prompt_tokens: Number.NaN, completion_tokens: 10 },
      { prompt_tokens: Number.POSITIVE_INFINITY, completion_tokens: 10 },
      { prompt_tokens: 10.5, completion_tokens: 10 },
      { prompt_tokens: 10 },
      { prompt_tokens: 1e15, completion_tokens: 1e15 },
      'uso',
      [],
      42,
    ]

    for (const uso of usos) {
      const { deps, chamadas } = montarDeps({
        classificacao: { ok: true, conteudo: '{"intencao":"vendas_dia"}', uso },
      })
      await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

      expect(chamadas.reconciliar).toHaveLength(0)
      expect(chamadas.liberar).toHaveLength(0)
    }
  })

  it('custoDaChamada so devolve inteiro finito nao-negativo', () => {
    expect(custoDaChamada({ prompt_tokens: 1, completion_tokens: 1 })).toBe(
      Math.ceil((1 * 300_000 + 1 * 1_200_000) / 1_000_000),
    )
    expect(custoDaChamada({ prompt_tokens: 0, completion_tokens: 0 })).toBe(0)

    for (const uso of [
      null,
      undefined,
      {},
      { prompt_tokens: 1 },
      { prompt_tokens: 1, completion_tokens: '1' },
      { prompt_tokens: -1, completion_tokens: 1 },
      { prompt_tokens: 1, completion_tokens: -1 },
      { prompt_tokens: 1.5, completion_tokens: 1 },
      { prompt_tokens: Number.NaN, completion_tokens: 1 },
      { prompt_tokens: 1e15, completion_tokens: 1e15 },
      { prompt_tokens: 1, completion_tokens: 1, extra: true },
    ]) {
      const micros = custoDaChamada(uso)
      if (micros !== null) {
        expect(Number.isSafeInteger(micros)).toBe(true)
        expect(micros).toBeGreaterThanOrEqual(0)
      }
    }

    expect(custoDaChamada({ prompt_tokens: 1, completion_tokens: 1, extra: true })).toBe(
      Math.ceil((300_000 + 1_200_000) / 1_000_000),
    )

    // O teto de tokens e o mesmo dimensionamento da reserva: no limite passa,
    // acima dele o custo e desconhecido (a reserva fica em vez de virar um
    // numero absurdo no contador do mes).
    expect(custoDaChamada({ prompt_tokens: TOKENS_ENTRADA_RESERVA, completion_tokens: MAX_TOKENS_SAIDA })).toBe(
      RESERVA_MICROS,
    )
    expect(custoDaChamada({ prompt_tokens: TOKENS_ENTRADA_RESERVA + 1, completion_tokens: 1 })).toBeNull()
    expect(custoDaChamada({ prompt_tokens: 1, completion_tokens: MAX_TOKENS_SAIDA + 1 })).toBeNull()
  })

  it('falha do ledger ao reconciliar/liberar nao derruba a resposta', async () => {
    const reconciliacao = montarDeps({ reconciliarLanca: true })
    const comReconciliacao = await processarPergunta(entrada('Como foram as vendas?'), reconciliacao.deps)
    expect(comReconciliacao.status).toBe(200)

    const liberacao = montarDeps({
      classificacao: { ok: false, fase: 'pre_envio' },
      liberarLanca: true,
    })
    const comLiberacao = await processarPergunta(entrada('Como foram as vendas?'), liberacao.deps)
    expect(comLiberacao.status).toBe(502)
  })
})

// ============================================================
// 4. Classificacao estrita e a view certa por intencao.
// ============================================================

describe('classificacao e consulta', () => {
  it('JSON invalido, chave a mais e intencao desconhecida recusam sem consultar', async () => {
    const conteudos = [
      'nao sei responder',
      '',
      '{"intencao":"vendas_dia","extra":1}',
      '{"intencao":"clientes"}',
      '{"intencao":"vendas_dia","de":"2026-10-01"}',
      '{"intencao":"vendas_dia","de":"2026-10-31","ate":"2026-10-01"}',
      '{"intencao":"mais_vendidos","de":"2026-10-01","ate":"2026-10-09"}',
      '["vendas_dia"]',
    ]

    for (const conteudo of conteudos) {
      const { deps, chamadas } = montarDeps({
        classificacao: { ok: true, conteudo, uso: { prompt_tokens: 100, completion_tokens: 5 } },
      })
      const resposta = await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

      expect(resposta).toEqual({ status: 400, corpo: { erro: mensagemRecusa('classificacao') } })
      expect(chamadas.consultar).toHaveLength(0)
    }
  })

  it('fora_escopo recusa sem consultar view nenhuma', async () => {
    const { deps, chamadas } = montarDeps({
      classificacao: { ok: true, conteudo: '{"intencao":"fora_escopo"}', uso: { prompt_tokens: 90, completion_tokens: 8 } },
    })
    const resposta = await processarPergunta(entrada('Qual a previsao do tempo?'), deps)

    expect(resposta).toEqual({ status: 400, corpo: { erro: mensagemRecusa('classificacao') } })
    expect(chamadas.consultar).toHaveLength(0)
    // O custo da classificacao foi gasto: a reserva e reconciliada, nao liberada.
    expect(chamadas.reconciliar).toHaveLength(1)
  })

  it('vendas_dia sem periodo consulta HOJE e NAO corta em 10 linhas', async () => {
    const { deps, chamadas } = montarDeps()
    const resposta = await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

    expect(resposta.status).toBe(200)
    expect(chamadas.consultar).toEqual([
      { intencao: 'vendas_dia', filtro: { de: HOJE, ate: HOJE }, limite: null },
    ])
  })

  it('vendas_dia com periodo explicito repassa as duas pontas validadas', async () => {
    const { deps, chamadas } = montarDeps({
      classificacao: {
        ok: true,
        conteudo: '{"intencao":"vendas_dia","de":"2026-10-01","ate":"2026-10-09"}',
        uso: null,
      },
    })
    await processarPergunta(entrada('Como foram as vendas do mes?'), deps)

    expect(chamadas.consultar).toEqual([
      { intencao: 'vendas_dia', filtro: { de: '2026-10-01', ate: '2026-10-09' }, limite: null },
    ])
  })

  it('cada intencao sem data consulta a PROPRIA view com 10 linhas na ordem da view', async () => {
    const casos: { conteudo: string; intencao: IntencaoConsulta; limite: number }[] = [
      { conteudo: '{"intencao":"mais_vendidos"}', intencao: 'mais_vendidos', limite: LIMITE_RESULTADOS },
      { conteudo: '{"intencao":"estoque_baixo"}', intencao: 'estoque_baixo', limite: LIMITE_RESULTADOS },
      { conteudo: '{"intencao":"estoque_parado"}', intencao: 'estoque_parado', limite: LIMITE_RESULTADOS },
      { conteudo: '{"intencao":"mais_vendidos","limite":3}', intencao: 'mais_vendidos', limite: 3 },
    ]

    for (const caso of casos) {
      const { deps, chamadas } = montarDeps({
        classificacao: { ok: true, conteudo: caso.conteudo, uso: null },
      })
      await processarPergunta(entrada('Quais produtos mais venderam?'), deps)

      expect(chamadas.consultar).toEqual([
        { intencao: caso.intencao, filtro: null, limite: caso.limite },
      ])
    }
  })

  it('a pergunta chega ao provedor aparada e e a unica pergunta enviada', async () => {
    const { deps, chamadas } = montarDeps()
    await processarPergunta(entrada('   Como foram as vendas de hoje?   '), deps)

    expect(chamadas.classificar).toEqual(['Como foram as vendas de hoje?'])
    expect(chamadas.consultar).toHaveLength(1)
  })

  it('dialoga com o relogio injetado: mes e hoje saem do MESMO agora', async () => {
    // 22h30 de 31/10 em Sao Paulo ja e 01/11 em UTC: o mes do orcamento e o de
    // quem esta no balcao, e o "hoje" da validacao tambem.
    const { deps, chamadas } = montarDeps({
      classificacao: { ok: true, conteudo: '{"intencao":"vendas_dia"}', uso: null },
    })
    const depsDeVirada: Deps = { ...deps, agora: () => new Date('2026-11-01T01:30:00Z') }

    await processarPergunta(entrada('Como foram as vendas de hoje?'), depsDeVirada)

    expect(chamadas.reservar[0]!.mes).toBe('2026-10-01')
    expect(chamadas.consultar[0]!.filtro).toEqual({ de: '2026-10-31', ate: '2026-10-31' })
  })
})

// ============================================================
// 5. Leitura e resposta montada por codigo.
// ============================================================

describe('leitura e resposta', () => {
  it('falha de leitura devolve mensagem curta, sem detalhe tecnico', async () => {
    for (const opcoes of [
      { leitura: { ok: false } as ResultadoConsulta },
      { leituraLanca: true },
    ]) {
      const { deps } = montarDeps(opcoes)
      const resposta = await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

      expect(resposta.status).toBe(500)
      const erro = (resposta.corpo as { erro: string }).erro
      expect(erro.length).toBeGreaterThan(0)
      expect(erro.length).toBeLessThan(120)
      for (const veneno of ['postgrest', 'PGRST', 'Error', 'error', 'stack', 'supabase', 'null']) {
        expect(erro).not.toContain(veneno)
      }
    }
  })

  it('a resposta e o texto montado pelo servidor, nunca a saida do modelo', async () => {
    const conteudo = '{"intencao":"mais_vendidos","limite":10}'
    const { deps } = montarDeps({
      classificacao: { ok: true, conteudo, uso: null },
      leitura: {
        ok: true,
        linhas: [
          { nome: 'Dipirona 500mg', quantidade: 42 },
          { nome: 'Soro', quantidade: 7 },
        ],
      },
    })

    const resposta = await processarPergunta(entrada('Quais produtos mais venderam?'), deps)

    expect(resposta).toEqual({
      status: 200,
      corpo: { resposta: 'Produtos mais vendidos\n1. Dipirona 500mg: 42 unidades\n2. Soro: 7 unidades' },
    })
    expect(JSON.stringify(resposta)).not.toContain('intencao')
  })

  it('os valores da view viram a resposta de vendas com data civil e dinheiro', async () => {
    const { deps } = montarDeps({
      leitura: {
        ok: true,
        linhas: [{ dia: '2026-10-09', quantidade: 3, total: 4500, ticket_medio: 1500 }],
      },
    })

    const resposta = await processarPergunta(entrada('Como foram as vendas de hoje?'), deps)

    expect(resposta.corpo).toEqual({
      resposta:
        'Vendas por dia\n' +
        '09/10/2026: 3 vendas, R$ 45,00 de total, ticket medio de R$ 15,00\n' +
        'Total: 3 vendas e R$ 45,00',
    })
  })

  it('linha torta da view nao vira NaN nem texto solto na resposta', async () => {
    const { deps } = montarDeps({
      classificacao: { ok: true, conteudo: '{"intencao":"estoque_baixo"}', uso: null },
      leitura: { ok: true, linhas: [{ nome: 'Amoxicilina', estoque_atual: 'oito' }, { nome: null }] },
    })

    const resposta = await processarPergunta(entrada('O que preciso repor?'), deps)
    const texto = (resposta.corpo as { resposta: string }).resposta

    expect(resposta.status).toBe(200)
    expect(texto).toContain('Amoxicilina: 0 em estoque')
    expect(texto).not.toContain('NaN')
  })

  it('lista vazia recebe a mensagem fixa em portugues, nao uma resposta inventada', async () => {
    for (const [conteudo, esperado] of [
      ['{"intencao":"vendas_dia"}', 'Não há vendas registradas no período consultado.'],
      ['{"intencao":"mais_vendidos"}', 'Ainda não há produtos vendidos registrados.'],
      ['{"intencao":"estoque_baixo"}', 'Nenhum produto precisa de reposição no momento.'],
      ['{"intencao":"estoque_parado"}', 'Nenhum produto está parado no momento.'],
    ] as const) {
      const { deps } = montarDeps({ classificacao: { ok: true, conteudo, uso: null } })
      const resposta = await processarPergunta(entrada('Qualquer pergunta gerencial?'), deps)

      expect(resposta.corpo).toEqual({ resposta: esperado })
    }
  })
})
