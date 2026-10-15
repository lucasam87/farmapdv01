import { describe, expect, it } from 'vitest'
import { CONSULTAS_FINANCEIRO, validarConsultaFinanceiro, validarAssunto } from './logica'
import { PROMPT_FINANCEIRO, promptFinanceiro } from '@/lib/agente/deepseek'

// ============================================================
// ESPECIALISTA de Vendas e financeiro — a segunda fatia do agente em grafo.
//
// Ele le `relatorio_resumo`, `relatorio_lucro` e `relatorio_formas_pagamento`,
// que JA EXISTEM: e o unico especialista que nao precisa de banco nenhum.
//
// O texto final continua sendo montado em CODIGO. O modelo so escolhe a consulta
// e o periodo — nunca escreve um numero.
// ============================================================

const HOJE = '2026-10-15'

describe('validarAssunto aceita o que o MODELO devolve', () => {
  it('aceita a string de conteudo, nao so o objeto ja parseado', () => {
    // Achado na fatia 2: `validarClassificacao` parseia a string de conteudo
    // (`logica.ts:1000`) porque e isso que a rota entrega. O coordenador recusava
    // string — ou seja, recusaria a saida real do modelo e o grafo nunca andaria.
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

describe('validarConsultaFinanceiro', () => {
  it('aceita as cinco consultas do dominio', () => {
    for (const consulta of CONSULTAS_FINANCEIRO) {
      const saida = validarConsultaFinanceiro({ consulta, de: null, ate: null }, HOJE)
      expect(saida?.consulta).toBe(consulta)
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
    expect(saida).toEqual({ consulta: 'faturamento', de: '2026-09-16', ate: '2026-10-15' })
  })

  it('aceita periodo explicito e devolve as duas pontas', () => {
    const saida = validarConsultaFinanceiro(
      { consulta: 'lucro', de: '2026-10-01', ate: '2026-10-07' },
      HOJE,
    )
    expect(saida).toEqual({ consulta: 'lucro', de: '2026-10-01', ate: '2026-10-07' })
  })

  it('recusa uma ponta so — chutar a outra seria inventar o periodo pedido', () => {
    expect(validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-10-01', ate: null }, HOJE)).toBeNull()
    expect(validarConsultaFinanceiro({ consulta: 'lucro', de: null, ate: '2026-10-07' }, HOJE)).toBeNull()
  })

  it('recusa periodo invertido', () => {
    expect(
      validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-10-07', ate: '2026-10-01' }, HOJE),
    ).toBeNull()
  })

  it('recusa data no FUTURO — venda que ainda nao aconteceu nao existe', () => {
    expect(
      validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-10-16', ate: '2026-10-20' }, HOJE),
    ).toBeNull()
    expect(
      validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-10-01', ate: '2026-10-16' }, HOJE),
    ).toBeNull()
  })

  it('recusa periodo maior que o teto, e aceita exatamente no teto', () => {
    // 31 datas inclusivas passam; 32 nao.
    expect(
      validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-09-15', ate: '2026-10-15' }, HOJE),
    ).not.toBeNull()
    expect(
      validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-09-14', ate: '2026-10-15' }, HOJE),
    ).toBeNull()
  })

  it('recusa data que nao existe no calendario', () => {
    expect(
      validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-02-30', ate: '2026-03-01' }, HOJE),
    ).toBeNull()
    expect(
      validarConsultaFinanceiro({ consulta: 'lucro', de: '2026-13-01', ate: '2026-13-02' }, HOJE),
    ).toBeNull()
  })

  it('recusa consulta fora da lista', () => {
    expect(validarConsultaFinanceiro({ consulta: 'margem', de: null, ate: null }, HOJE)).toBeNull()
    expect(validarConsultaFinanceiro({ consulta: 'estoque_baixo', de: null, ate: null }, HOJE)).toBeNull()
    expect(validarConsultaFinanceiro({ consulta: '', de: null, ate: null }, HOJE)).toBeNull()
  })

  it('recusa o formato do COORDENADOR e o do outro nivel do grafo', () => {
    expect(validarConsultaFinanceiro({ assunto: 'financeiro' }, HOJE)).toBeNull()
    expect(validarConsultaFinanceiro({ intencao: 'vendas_dia', de: null, ate: null }, HOJE)).toBeNull()
  })

  it('recusa chave a mais', () => {
    expect(
      validarConsultaFinanceiro({ consulta: 'lucro', de: null, ate: null, limite: 10 }, HOJE),
    ).toBeNull()
  })

  it('recusa o que nao e objeto', () => {
    expect(validarConsultaFinanceiro(null, HOJE)).toBeNull()
    expect(validarConsultaFinanceiro('lucro', HOJE)).toBeNull()
    expect(validarConsultaFinanceiro([], HOJE)).toBeNull()
    expect(validarConsultaFinanceiro({}, HOJE)).toBeNull()
    expect(validarConsultaFinanceiro({ consulta: 1 }, HOJE)).toBeNull()
  })

  it('aceita a string de conteudo do modelo', () => {
    const saida = validarConsultaFinanceiro(
      '{"consulta": "ticket_medio", "de": null, "ate": null}',
      HOJE,
    )
    expect(saida).toEqual({ consulta: 'ticket_medio', de: '2026-09-16', ate: '2026-10-15' })
  })

  it('chave faltando e recusa, nao "null implicito"', () => {
    // `de`/`ate` ausentes NAO sao o mesmo que `de: null`/`ate: null`: o contrato do
    // prompt pede as tres chaves, e uma resposta truncada nao pode virar "30 dias".
    expect(validarConsultaFinanceiro({ consulta: 'lucro' }, HOJE)).toBeNull()
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
})
