import { describe, expect, it } from 'vitest'
import { respostaFinanceiro, type DadosFinanceiro } from './logica'

// ============================================================
// O MONTADOR DE RESPOSTA do especialista de Vendas e financeiro.
//
// Esta e a peca que fecha a promessa do desenho: **todo numero que o dono le e
// escrito AQUI, em codigo**, a partir do que a funcao do banco devolveu. O modelo
// so escolheu a consulta e o periodo — ele nunca escreve um valor.
//
// Valores em CENTAVOS INTEIROS, como as funcoes de `016_relatorios.sql` devolvem.
// ============================================================

const PERIODO = { de: '2026-10-01', ate: '2026-10-07' }
const RESUMO = { faturamento: 123_456, vendas: 12, ticket_medio: 10_288 }

function faturamento(dados: Partial<DadosFinanceiro> = {}): string {
  return respostaFinanceiro({
    consulta: 'faturamento',
    periodo: PERIODO,
    resumo: RESUMO,
    ...dados,
  } as DadosFinanceiro)
}

describe('faturamento', () => {
  it('declara o periodo e o total, com o numero de vendas', () => {
    expect(faturamento()).toBe(
      'Faturamento (01/10/2026 a 07/10/2026)\nR$ 1.234,56 em 12 vendas.',
    )
  })

  it('fala no SINGULAR com uma venda so', () => {
    const texto = faturamento({ resumo: { faturamento: 5_000, vendas: 1, ticket_medio: 5_000 } })
    expect(texto).toContain('em 1 venda.')
    expect(texto).not.toContain('1 vendas')
  })

  it('periodo sem venda diz que nao houve venda — nao "R$ 0,00"', () => {
    const texto = faturamento({ resumo: { faturamento: 0, vendas: 0, ticket_medio: 0 } })
    expect(texto).toBe('Não há vendas registradas no período consultado.')
  })
})

describe('ticket_medio', () => {
  it('mostra o valor por venda e quantas vendas o formaram', () => {
    const texto = respostaFinanceiro({
      consulta: 'ticket_medio',
      periodo: PERIODO,
      resumo: RESUMO,
    })
    expect(texto).toBe('Ticket médio (01/10/2026 a 07/10/2026)\nR$ 102,88 por venda, em 12 vendas.')
  })

  it('sem venda, o ticket nao e "R$ 0,00" — e ausencia de dado', () => {
    const texto = respostaFinanceiro({
      consulta: 'ticket_medio',
      periodo: PERIODO,
      resumo: { faturamento: 0, vendas: 0, ticket_medio: 0 },
    })
    expect(texto).toBe('Não há vendas registradas no período consultado.')
  })
})

describe('formas_pagamento', () => {
  it('lista as formas com total e quantidade, numeradas', () => {
    const texto = respostaFinanceiro({
      consulta: 'formas_pagamento',
      periodo: PERIODO,
      formas: [
        { forma: 'dinheiro', quantidade: 5, total: 50_000 },
        { forma: 'pix', quantidade: 7, total: 73_456 },
      ],
    })
    expect(texto).toBe(
      'Formas de pagamento (01/10/2026 a 07/10/2026)\n' +
        '1. dinheiro: R$ 500,00 em 5 vendas.\n' +
        '2. pix: R$ 734,56 em 7 vendas.',
    )
  })

  it('a ultima forma tambem fala no singular com uma venda', () => {
    const texto = respostaFinanceiro({
      consulta: 'formas_pagamento',
      periodo: PERIODO,
      formas: [{ forma: 'dinheiro', quantidade: 1, total: 1_000 }],
    })
    expect(texto).toContain('1. dinheiro: R$ 10,00 em 1 venda.')
  })

  it('lista vazia diz que nao houve venda', () => {
    const texto = respostaFinanceiro({ consulta: 'formas_pagamento', periodo: PERIODO, formas: [] })
    expect(texto).toBe('Formas de pagamento (01/10/2026 a 07/10/2026)\n' +
      'Não há vendas registradas no período consultado.')
  })
})

describe('lucro', () => {
  it('mostra receita, custo, lucro e o percentual sobre a receita', () => {
    const texto = respostaFinanceiro({
      consulta: 'lucro',
      periodo: PERIODO,
      lucro: { receita: 100_000, custo: 60_000, lucro: 40_000 },
    })
    expect(texto).toBe(
      'Lucro (01/10/2026 a 07/10/2026)\n' +
        'Receita de R$ 1.000,00, custo de R$ 600,00, lucro de R$ 400,00 (40,0%).',
    )
  })

  it('lucro NEGATIVO sai com o sinal e o percentual negativo — vender abaixo do custo existe', () => {
    const texto = respostaFinanceiro({
      consulta: 'lucro',
      periodo: PERIODO,
      lucro: { receita: 100_000, custo: 130_000, lucro: -30_000 },
    })
    expect(texto).toContain('lucro de -R$ 300,00 (-30,0%)')
  })

  it('receita zero nao inventa percentual', () => {
    const texto = respostaFinanceiro({
      consulta: 'lucro',
      periodo: PERIODO,
      lucro: { receita: 0, custo: 0, lucro: 0 },
    })
    expect(texto).not.toContain('%')
    expect(texto).toContain('Não há vendas registradas no período consultado.')
  })
})

describe('comparacao', () => {
  it('compara faturamento e vendas, e diz a DIFERENCA em palavras', () => {
    const texto = respostaFinanceiro({
      consulta: 'comparacao',
      periodo: PERIODO,
      atual: RESUMO,
      anteriorPeriodo: { de: '2026-09-24', ate: '2026-09-30' },
      anterior: { faturamento: 100_000, vendas: 10, ticket_medio: 10_000 },
    })
    expect(texto).toBe(
      'Comparação (01/10/2026 a 07/10/2026 contra 24/09/2026 a 30/09/2026)\n' +
        'Faturamento de R$ 1.234,56 contra R$ 1.000,00: R$ 234,56 a mais.\n' +
        'Vendas: 12 contra 10.',
    )
  })

  it('queda e dita como queda, com o valor em modulo', () => {
    const texto = respostaFinanceiro({
      consulta: 'comparacao',
      periodo: PERIODO,
      atual: { faturamento: 80_000, vendas: 8, ticket_medio: 10_000 },
      anteriorPeriodo: { de: '2026-09-24', ate: '2026-09-30' },
      anterior: { faturamento: 100_000, vendas: 10, ticket_medio: 10_000 },
    })
    expect(texto).toContain('R$ 200,00 a menos.')
  })

  it('empate nao vira "R$ 0,00 a mais" nem "a menos"', () => {
    const texto = respostaFinanceiro({
      consulta: 'comparacao',
      periodo: PERIODO,
      atual: { faturamento: 100_000, vendas: 10, ticket_medio: 10_000 },
      anteriorPeriodo: { de: '2026-09-24', ate: '2026-09-30' },
      anterior: { faturamento: 100_000, vendas: 10, ticket_medio: 10_000 },
    })
    expect(texto).toContain('mesmo faturamento.')
    expect(texto).not.toContain('a mais')
    expect(texto).not.toContain('a menos')
  })

  it('periodo anterior sem venda nao quebra a comparacao', () => {
    const texto = respostaFinanceiro({
      consulta: 'comparacao',
      periodo: PERIODO,
      atual: RESUMO,
      anteriorPeriodo: { de: '2026-09-24', ate: '2026-09-30' },
      anterior: { faturamento: 0, vendas: 0, ticket_medio: 0 },
    })
    expect(texto).toContain('R$ 1.234,56 contra R$ 0,00: R$ 1.234,56 a mais.')
    expect(texto).toContain('Vendas: 12 contra 0.')
  })
})
