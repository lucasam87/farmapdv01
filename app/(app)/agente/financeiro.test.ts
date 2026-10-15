import { describe, expect, it } from 'vitest'
import { CONSULTAS_FINANCEIRO, mensagemRecusa, validarConsultaFinanceiro, validarAssunto } from './logica'
import { PROMPT_FINANCEIRO, promptFinanceiro } from '@/lib/agente/deepseek'

// ============================================================
// ESPECIALISTA de Vendas e financeiro — a segunda fatia do agente em grafo.
//
// Ele le `relatorio_resumo`, `relatorio_lucro` e `relatorio_formas_pagamento`,
// que JA EXISTEM: e o unico especialista que nao precisa de banco nenhum.
//
// O texto final continua sendo montado em CODIGO. O modelo so escolhe a consulta
// e o periodo — nunca escreve um numero.
//
// ⚠️ `validarConsultaFinanceiro` devolve resultado DISCRIMINADO (achado da
// re-revisao de 16/10/2026): `{ok:true, consulta}` ou `{ok:false, motivo}`. O
// motivo separa a recusa HONESTA por tamanho (`'periodo'` — o pedido foi entendido,
// o periodo e que nao cabe) do "nao entendi" (`'formato'`). Sem isso, quem pedia
// "esse ano" lia "Nao entendi a pergunta" e reformulava igual — e a recusa e
// deterministica, entao nunca passava e cada tentativa pagava o par de chamadas.
// ============================================================

const HOJE = '2026-10-15'

/** O `motivo` de uma recusa, exigindo que ela TENHA falhado. */
function motivo(saida: ReturnType<typeof validarConsultaFinanceiro>): string | null {
  return saida.ok ? null : saida.motivo
}

/** A consulta validada, exigindo que ela TENHA passado. */
function consultaDe(saida: ReturnType<typeof validarConsultaFinanceiro>) {
  if (!saida.ok) throw new Error(`esperava sucesso, veio recusa: ${saida.motivo}`)
  return saida.consulta
}

describe('validarAssunto aceita o que o MODELO devolve', () => {
  it('aceita a string de conteudo, nao so o objeto ja parseado', () => {
    // `validarClassificacao` parseia a string de conteudo (`logica.ts`) porque e
    // isso que a rota entrega. O coordenador recusava string — ou seja, recusaria a
    // saida real do modelo e o grafo nunca andaria.
    expect(validarAssunto('{"assunto": "estoque"}')).toBe('estoque')
    expect(validarAssunto('  {"assunto":"financeiro"}  ')).toBe('financeiro')
  })

  it('string que nao e JSON, ou JSON com chave errada, continua recusa', () => {
    expect(validarAssunto('estoque')).toBeNull()
    expect(validarAssunto('{')).toBeNull()
    expect(validarAssunto('{"intencao": "estoque"}')).toBeNull()
    expect(validarAssunto('{"assunto": "vendas"}')).toBeNull()
  })
})

describe('validarConsultaFinanceiro — o que passa', () => {
  it('aceita as cinco consultas do dominio', () => {
    for (const consulta of CONSULTAS_FINANCEIRO) {
      const saida = validarConsultaFinanceiro({ consulta, de: null, ate: null }, HOJE)
      expect(consultaDe(saida).consulta).toBe(consulta)
    }
  })

  it('a lista e fechada e tem exatamente cinco', () => {
    expect(CONSULTAS_FINANCEIRO).toHaveLength(5)
    expect([...CONSULTAS_FINANCEIRO].sort()).toEqual(
      ['comparacao', 'faturamento', 'formas_pagamento', 'lucro', 'ticket_medio'].sort(),
    )
  })

  it('sem data, o periodo padrao sao os ultimos 30 dias, com hoje numa ponta', () => {
    const saida = validarConsultaFinanceiro({ consulta: 'faturamento', de: null, ate: null }, HOJE)
    expect(consultaDe(saida)).toEqual({
      consulta: 'faturamento',
      de: '2026-09-16',
      ate: '2026-10-15',
    })
  })

  it('aceita periodo explicito e devolve as duas pontas', () => {
    const saida = validarConsultaFinanceiro(
      { consulta: 'lucro', de: '2026-10-01', ate: '2026-10-07' },
      HOJE,
    )
    expect(consultaDe(saida)).toEqual({ consulta: 'lucro', de: '2026-10-01', ate: '2026-10-07' })
  })

  it('aceita a string de conteudo do modelo', () => {
    const saida = validarConsultaFinanceiro(
      '{"consulta": "ticket_medio", "de": null, "ate": null}',
      HOJE,
    )
    expect(consultaDe(saida)).toEqual({
      consulta: 'ticket_medio',
      de: '2026-09-16',
      ate: '2026-10-15',
    })
  })

  it('aceita EXATAMENTE no teto: 31 datas inclusivas', () => {
    const saida = validarConsultaFinanceiro(
      { consulta: 'lucro', de: '2026-09-15', ate: '2026-10-15' },
      HOJE,
    )
    expect(saida.ok).toBe(true)
  })
})

describe('validarConsultaFinanceiro — motivo PERIODO (recusa honesta)', () => {
  it('32 dias com datas validas: o pedido foi entendido, o periodo e que nao cabe', () => {
    // ⚠️ Este e o caso que motiva o motivo proprio. Nao e "nao entendi": as duas
    // datas existem, estao em ordem e nao sao futuras — so passam do teto.
    const saida = validarConsultaFinanceiro(
      { consulta: 'lucro', de: '2026-09-14', ate: '2026-10-15' },
      HOJE,
    )
    expect(motivo(saida)).toBe('periodo')
  })

  it('"esse ano" (1 de janeiro ate hoje) tambem e PERIODO, nao formato', () => {
    const saida = validarConsultaFinanceiro(
      { consulta: 'faturamento', de: '2026-01-01', ate: '2026-10-15' },
      HOJE,
    )
    expect(motivo(saida)).toBe('periodo')
  })

  it('a mensagem do periodo diz o que fazer, e usa o TETO REAL', () => {
    // Se ela citasse um numero solto, mudar `DIAS_MAXIMOS` deixaria a mensagem
    // mentindo. A assercao prende os dois juntos.
    expect(mensagemRecusa('periodo')).toContain('31')
    expect(mensagemRecusa('periodo')).toContain('período menor')
  })

  it('periodo grande NAO vira "nao entendi"', () => {
    expect(mensagemRecusa('periodo')).not.toBe(mensagemRecusa('classificacao'))
  })
})

describe('validarConsultaFinanceiro — motivo FORMATO (nao entendi, de verdade)', () => {
  it('recusa uma ponta so — chutar a outra seria inventar o periodo pedido', () => {
    expect(motivo(validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-10-01', ate: null }, HOJE))).toBe('formato')
    expect(motivo(validarConsultaFinanceiro({ consulta: 'lucro', de: null, ate: '2026-10-07' }, HOJE))).toBe('formato')
  })

  it('recusa periodo invertido', () => {
    expect(
      motivo(validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-10-07', ate: '2026-10-01' }, HOJE)),
    ).toBe('formato')
  })

  it('recusa data no FUTURO — venda que ainda nao aconteceu nao existe', () => {
    expect(
      motivo(validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-10-16', ate: '2026-10-20' }, HOJE)),
    ).toBe('formato')
    expect(
      motivo(validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-10-01', ate: '2026-10-16' }, HOJE)),
    ).toBe('formato')
  })

  it('data inexistente no calendario e FORMATO, nao periodo', () => {
    // 32 dias E data torta ao mesmo tempo: o que manda e o formato, porque nao ha
    // periodo real para o dono encurtar.
    expect(
      motivo(validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-02-30', ate: '2026-04-01' }, HOJE)),
    ).toBe('formato')
    expect(
      motivo(validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-13-01', ate: '2026-13-02' }, HOJE)),
    ).toBe('formato')
  })

  it('recusa consulta fora da lista', () => {
    expect(motivo(validarConsultaFinanceiro({ consulta: 'margem', de: null, ate: null }, HOJE))).toBe('formato')
    expect(motivo(validarConsultaFinanceiro({ consulta: 'estoque_baixo', de: null, ate: null }, HOJE))).toBe('formato')
    expect(motivo(validarConsultaFinanceiro({ consulta: '', de: null, ate: null }, HOJE))).toBe('formato')
  })

  it('recusa o formato do COORDENADOR e o do outro nivel do grafo', () => {
    expect(motivo(validarConsultaFinanceiro({ assunto: 'financeiro' }, HOJE))).toBe('formato')
    expect(motivo(validarConsultaFinanceiro({ intencao: 'vendas_dia', de: null, ate: null }, HOJE))).toBe('formato')
  })

  it('recusa chave a mais', () => {
    expect(
      motivo(validarConsultaFinanceiro({ consulta: 'lucro', de: null, ate: null, limite: 10 }, HOJE)),
    ).toBe('formato')
  })

  it('recusa o que nao e objeto', () => {
    expect(motivo(validarConsultaFinanceiro(null, HOJE))).toBe('formato')
    expect(motivo(validarConsultaFinanceiro('lucro', HOJE))).toBe('formato')
    expect(motivo(validarConsultaFinanceiro([], HOJE))).toBe('formato')
    expect(motivo(validarConsultaFinanceiro({}, HOJE))).toBe('formato')
    expect(motivo(validarConsultaFinanceiro({ consulta: 1 }, HOJE))).toBe('formato')
  })

  it('chave faltando e recusa, nao "null implicito"', () => {
    // `de`/`ate` ausentes NAO sao o mesmo que `de: null`/`ate: null`: o contrato do
    // prompt pede as tres chaves, e uma resposta truncada nao pode virar "30 dias".
    expect(motivo(validarConsultaFinanceiro({ consulta: 'lucro' }, HOJE))).toBe('formato')
  })
})

describe('PROMPT_FINANCEIRO', () => {
  it('tem json e um exemplo literal — as duas exigencias do modo JSON', () => {
    expect(PROMPT_FINANCEIRO.toLowerCase()).toContain('json')
    expect(PROMPT_FINANCEIRO).toContain('{"consulta"')
  })

  it('nomeia as cinco consultas', () => {
    for (const consulta of CONSULTAS_FINANCEIRO) {
      expect(PROMPT_FINANCEIRO).toContain(consulta)
    }
  })

  it('nao tem data propria e recebe a data por parametro', () => {
    expect(PROMPT_FINANCEIRO).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    const prompt = promptFinanceiro(HOJE)
    expect(prompt.startsWith(PROMPT_FINANCEIRO)).toBe(true)
    expect(prompt).toContain(HOJE)
  })

  it('declara o padrao de 30 dias e o teto de 31 — sem isso o modelo chuta', () => {
    expect(promptFinanceiro(HOJE)).toContain('30')
    expect(promptFinanceiro(HOJE)).toContain('31')
  })

  it('PROIBE encurtar o periodo para caber no teto', () => {
    // Sem esta linha o modelo tem uma saida silenciosa para "esse ano": entregar um
    // periodo menor, que passa na validacao e responde CERTO para o periodo ERRADO.
    expect(promptFinanceiro(HOJE)).toContain('NUNCA encurte')
  })

  it('cabe no teto de payload', () => {
    // A convencao do projeto e metade de `LIMITE_PAYLOAD_BYTES`; o prompt do
    // especialista e o unico que nao tinha assercao de tamanho.
    expect(promptFinanceiro(HOJE).length).toBeLessThan(2048)
  })
})
