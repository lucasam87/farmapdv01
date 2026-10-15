import { describe, expect, it } from 'vitest'
import { RESERVA_MICROS } from '@/app/(app)/agente/logica'
import type { ResultadoClassificacao } from '@/lib/agente/deepseek'
import {
  custoDaChamada,
  processarPergunta,
  type Deps,
  type Entrada,
  type FiltroConsulta,
  type IntencaoConsulta,
  type ResultadoConsulta,
  type ResultadoReserva,
} from './orquestracao'

// ============================================================
// O GRAFO ligado: coordenador -> especialista.
//
// Isto e caminho de DINHEIRO alem de caminho de resposta. As duas regras que
// estes testes existem para prender:
//
//   1. **UMA reconciliacao, com a SOMA das duas chamadas.** `reconciliar`
//      SUBSTITUI o valor reservado pelo custo real — dois `reconciliar` na mesma
//      reserva se substituiriam e o mes pagaria por uma chamada so.
//   2. **Assunto NAO ligado cai no caminho de hoje**, sem regressao. Os quatro
//      especialistas que ainda nao existem nao podem piorar o que ja funciona.
// ============================================================

const AGORA = new Date('2026-10-09T14:00:00-03:00')
const HOJE = '2026-10-09'
const PERFIL_DONO = { id: 'perfil-1', nome: 'Ana', papel: 'dono' } as const
const PERFIL_ATENDENTE = { id: 'perfil-2', nome: 'Leila', papel: 'atendente' } as const

const USO_A = { prompt_tokens: 231, completion_tokens: 71 }
const USO_B = { prompt_tokens: 160, completion_tokens: 120 }

function classificacao(conteudo: string, uso: unknown = USO_A): ResultadoClassificacao {
  return { ok: true, conteudo, uso }
}

const LEITURA: ResultadoConsulta = {
  ok: true,
  linhas: [{ dia: HOJE, quantidade: 2, total: 3_000, ticket_medio: 1_500 }],
}

const DADOS_FINANCEIRO = {
  consulta: 'faturamento' as const,
  periodo: { de: '2026-09-10', ate: HOJE },
  resumo: { faturamento: 123_456, vendas: 12, ticket_medio: 10_288 },
}

type Opcoes = {
  assunto?: ResultadoClassificacao
  financeiro?: ResultadoClassificacao
  classificar?: ResultadoClassificacao
  ligarGrafo?: boolean
  fechar?: boolean
  /** O ESPECIALISTA (2a chamada) falha em `pre_envio`. */
  fecharFinanceiro?: boolean
  /** O classificador de hoje (2a chamada, no ramo de assunto nao ligado) falha. */
  fecharClassificar?: boolean
}

function montar(opcoes: Opcoes = {}) {
  const chamadas = {
    classificarAssunto: 0,
    classificarFinanceiro: 0,
    classificar: 0,
    reservar: [] as number[],
    reconciliar: [] as { id: string; micros: number }[],
    liberar: [] as string[],
    consultarFinanceiro: 0,
  }

  const deps: Deps = {
    agora: () => AGORA,
    async classificar() {
      chamadas.classificar += 1
      if (opcoes.fecharClassificar) return { ok: false, fase: 'pre_envio' }
      return opcoes.classificar ?? classificacao('{"intencao":"vendas_dia"}', USO_B)
    },
    async reservar(_mes: string, micros: number): Promise<ResultadoReserva> {
      chamadas.reservar.push(micros)
      return { ok: true, id: 'reserva-1' }
    },
    async reconciliar(id: string, micros: number) {
      chamadas.reconciliar.push({ id, micros })
    },
    async liberar(id: string) {
      chamadas.liberar.push(id)
    },
    async consultar(
      _intencao: IntencaoConsulta,
      _filtro: FiltroConsulta,
      _limite: number | null,
    ): Promise<ResultadoConsulta> {
      return LEITURA
    },
  }

  if (opcoes.ligarGrafo !== false) {
    deps.classificarAssunto = async () => {
      chamadas.classificarAssunto += 1
      return opcoes.fechar
        ? { ok: false, fase: 'pre_envio' }
        : (opcoes.assunto ?? classificacao('{"assunto":"estoque"}'))
    }
    deps.classificarFinanceiro = async () => {
      chamadas.classificarFinanceiro += 1
      if (opcoes.fecharFinanceiro) return { ok: false, fase: 'pre_envio' }
      return opcoes.financeiro ?? classificacao('{"consulta":"faturamento","de":null,"ate":null}', USO_B)
    }
    deps.consultarFinanceiro = async () => {
      chamadas.consultarFinanceiro += 1
      return DADOS_FINANCEIRO
    }
  }

  return { deps, chamadas }
}

function entrada(perfil: Entrada['perfil'] = PERFIL_DONO, pergunta = 'como foi o mes?'): Entrada {
  return { sessao: true, perfil, pergunta }
}

describe('sem as dependencias do grafo, o caminho de hoje vale igual', () => {
  it('reserva UMA chamada e chama o classificador de hoje uma vez', async () => {
    const { deps, chamadas } = montar({ ligarGrafo: false })
    const r = await processarPergunta(entrada(), deps)

    expect(r.status).toBe(200)
    expect(chamadas.reservar).toEqual([RESERVA_MICROS])
    expect(chamadas.classificar).toBe(1)
    expect(chamadas.classificarAssunto).toBe(0)
    expect(chamadas.classificarFinanceiro).toBe(0)
  })
})

describe('com o grafo ligado', () => {
  it('a reserva DOBRA — a pergunta gasta duas chamadas', async () => {
    const { deps, chamadas } = montar()
    await processarPergunta(entrada(), deps)
    expect(chamadas.reservar).toEqual([RESERVA_MICROS * 2])
  })

  it('especialista de financeiro responde, e o classificador de hoje NAO e chamado', async () => {
    const { deps, chamadas } = montar({
      assunto: classificacao('{"assunto":"financeiro"}'),
    })
    const r = await processarPergunta(entrada(), deps)

    expect(r.status).toBe(200)
    expect(chamadas.classificarAssunto).toBe(1)
    expect(chamadas.classificarFinanceiro).toBe(1)
    expect(chamadas.classificar).toBe(0)
    expect(chamadas.consultarFinanceiro).toBe(1)
    // O texto e o montado em CODIGO a partir dos dados, com o valor formatado.
    expect(r.corpo).toEqual({ resposta: expect.stringContaining('R$ 1.234,56') })
  })

  it('a reconciliacao e UMA SO, com a SOMA das duas chamadas', async () => {
    const { deps, chamadas } = montar({
      assunto: classificacao('{"assunto":"financeiro"}', USO_A),
    })
    await processarPergunta(entrada(), deps)

    // ⚠️ Esta e a regra do dinheiro: dois `reconciliar` na MESMA reserva se
    // substituiriam, e o mes pagaria por uma chamada so.
    expect(chamadas.reconciliar).toHaveLength(1)
    expect(chamadas.reconciliar[0]?.micros).toBe(
      custoDaChamada(USO_A)! + custoDaChamada(USO_B)!,
    )
  })

  it('assunto NAO ligado cai no caminho de hoje, com a soma reconciliada', async () => {
    const { deps, chamadas } = montar({
      assunto: classificacao('{"assunto":"estoque"}', USO_A),
    })
    const r = await processarPergunta(entrada(), deps)

    expect(r.status).toBe(200)
    expect(chamadas.classificarAssunto).toBe(1)
    // Duas chamadas: o coordenador e o classificador de hoje.
    expect(chamadas.classificar).toBe(1)
    expect(chamadas.classificarFinanceiro).toBe(0)
    expect(chamadas.reconciliar).toHaveLength(1)
    expect(chamadas.reconciliar[0]?.micros).toBe(
      custoDaChamada(USO_A)! + custoDaChamada(USO_B)!,
    )
  })

  it('fora_escopo continua sendo 400 — o coordenador nao inventa especialista', async () => {
    const { deps } = montar({ assunto: classificacao('{"assunto":"fora_escopo"}') })
    const r = await processarPergunta(entrada(), deps)
    expect(r.status).toBe(400)
  })

  it('assunto invalido cai no caminho de hoje (nao vira erro novo)', async () => {
    const { deps, chamadas } = montar({ assunto: classificacao('{"assunto":"vendas"}') })
    const r = await processarPergunta(entrada(), deps)
    expect(r.status).toBe(200)
    expect(chamadas.classificar).toBe(1)
  })

  it('consulta invalida do especialista e 400, e nada e lido', async () => {
    const { deps, chamadas } = montar({
      assunto: classificacao('{"assunto":"financeiro"}'),
      financeiro: classificacao('{"consulta":"margem","de":null,"ate":null}'),
    })
    const r = await processarPergunta(entrada(), deps)

    expect(r.status).toBe(400)
    expect(chamadas.consultarFinanceiro).toBe(0)
  })

  it('periodo GRANDE DEMAIS recebe a mensagem de periodo, nao "nao entendi"', async () => {
    // ⚠️ Achado da re-revisao (16/10/2026). Ate aqui o dono que pedia "esse ano"
    // (284 dias) lia "Nao entendi a pergunta. Tente reformular com vendas, produtos
    // mais vendidos, estoque baixo ou produtos parados" — DUAS falsidades: o modelo
    // ENTENDEU, e a sugestao manda quem perguntou de dinheiro perguntar de outra
    // coisa. A recusa e deterministica: reformular igual nunca passa, e cada
    // tentativa repaga o par de chamadas.
    const { deps, chamadas } = montar({
      assunto: classificacao('{"assunto":"financeiro"}'),
      financeiro: classificacao('{"consulta":"faturamento","de":"2026-01-01","ate":"2026-10-09"}'),
    })
    const r = await processarPergunta(entrada(), deps)

    expect(r.status).toBe(400)
    expect(JSON.stringify(r.corpo)).toContain('período menor')
    expect(JSON.stringify(r.corpo)).not.toContain('Não entendi')
    // Nada e lido do banco...
    expect(chamadas.consultarFinanceiro).toBe(0)
    // ...e o DINHEIRO JA FECHOU: as duas chamadas foram pagas e sao reconciliadas
    // pela SOMA antes da validacao.
    //
    // ⚠️ Achado M3 da revisao da rodada 2: sem estas duas assercoes, mover a
    // reconciliacao para DEPOIS da validacao deixava a suite INTEIRA verde (55/55)
    // — a ordem correta nao estava presa por nada. `consultarFinanceiro === 0`
    // prova que nada foi LIDO, nao que a reserva foi liquidada.
    expect(chamadas.reconciliar).toHaveLength(1)
    expect(chamadas.reconciliar[0]?.micros).toBe(custoDaChamada(USO_A)! * 2)
  })

  it('lucro e do dono: o atendente recebe 403 ANTES de qualquer leitura', async () => {
    const { deps, chamadas } = montar({
      assunto: classificacao('{"assunto":"financeiro"}'),
      financeiro: classificacao('{"consulta":"lucro","de":null,"ate":null}'),
    })
    const r = await processarPergunta(entrada(PERFIL_ATENDENTE), deps)

    expect(r.status).toBe(403)
    expect(chamadas.consultarFinanceiro).toBe(0)
  })

  it('faturamento NAO e do dono: o atendente recebe a resposta', async () => {
    const { deps } = montar({ assunto: classificacao('{"assunto":"financeiro"}') })
    const r = await processarPergunta(entrada(PERFIL_ATENDENTE), deps)
    expect(r.status).toBe(200)
  })

  it('usage desconhecido em qualquer das duas mantem a reserva consumida', async () => {
    // Sem `usage` o custo e desconhecido: liberar abriria espaco para tokens que
    // podem ter sido faturados. Nao se reconcilia com um numero inventado.
    const { deps, chamadas } = montar({
      assunto: classificacao('{"assunto":"financeiro"}', USO_A),
      financeiro: classificacao('{"consulta":"faturamento","de":null,"ate":null}', null),
    })
    const r = await processarPergunta(entrada(), deps)

    expect(r.status).toBe(200)
    expect(chamadas.reconciliar).toHaveLength(0)
  })

  it('coordenador com falha PRE-ENVIO libera a reserva', async () => {
    const { deps, chamadas } = montar({ fechar: true })
    const r = await processarPergunta(entrada(), deps)

    expect(r.status).toBe(502)
    expect(chamadas.liberar).toEqual(['reserva-1'])
    expect(chamadas.classificar).toBe(0)
  })
})

// ============================================================
// IMPORTANT 1 DA REVISAO INDEPENDENTE (16/10/2026)
//
// Com o grafo ligado, o coordenador JA respondeu e JA foi cobrado quando a SEGUNDA
// chamada falha em `pre_envio`. Liberar a reserva inteira ali faria o teto do mes
// medir MENOS do que a farmacia gastou. Estes testes existem por causa disso.
// ============================================================

describe('o coordenador ja cobrado NUNCA e liberado como se nada tivesse saido', () => {
  it('especialista com falha PRE-ENVIO: liquida o coordenador, NAO libera', async () => {
    const { deps, chamadas } = montar({
      assunto: classificacao('{"assunto":"financeiro"}', USO_A),
      fecharFinanceiro: true,
    })
    const r = await processarPergunta(entrada(), deps)

    expect(r.status).toBe(502)
    // A reserva inteira NAO volta: o que o coordenador gastou e cobrado.
    expect(chamadas.liberar).toEqual([])
    expect(chamadas.reconciliar).toHaveLength(1)
    expect(chamadas.reconciliar[0]?.micros).toBe(custoDaChamada(USO_A))
  })

  it('assunto NAO ligado + classificador de hoje com falha PRE-ENVIO: idem', async () => {
    const { deps, chamadas } = montar({
      assunto: classificacao('{"assunto":"estoque"}', USO_A),
      fecharClassificar: true,
    })
    const r = await processarPergunta(entrada(), deps)

    expect(r.status).toBe(502)
    expect(chamadas.liberar).toEqual([])
    expect(chamadas.reconciliar).toHaveLength(1)
    expect(chamadas.reconciliar[0]?.micros).toBe(custoDaChamada(USO_A))
  })

  it('coordenador com usage DESCONHECIDO: nao reconcilia com numero inventado e mantem a reserva', async () => {
    // Sem `usage` o custo do coordenador e desconhecido: nem se libera (pode ter
    // sido faturado) nem se reconcilia (nao se inventa um valor). A reserva fica
    // consumida — a regra conservadora do modulo.
    const { deps, chamadas } = montar({
      assunto: classificacao('{"assunto":"financeiro"}', null),
      fecharFinanceiro: true,
    })
    const r = await processarPergunta(entrada(), deps)

    expect(r.status).toBe(502)
    expect(chamadas.liberar).toEqual([])
    expect(chamadas.reconciliar).toHaveLength(0)
  })

  it('SEM grafo, a falha PRE-ENVIO da primeira chamada continua liberando', async () => {
    // O comportamento antigo nao pode ter mudado: sem grafo nada saiu antes dela.
    const { deps, chamadas } = montar({ ligarGrafo: false, fecharClassificar: true })
    const r = await processarPergunta(entrada(), deps)

    expect(r.status).toBe(502)
    expect(chamadas.liberar).toEqual(['reserva-1'])
    expect(chamadas.reconciliar).toHaveLength(0)
  })
})
