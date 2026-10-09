import { describe, it, expect } from 'vitest'
import { atalhos, diasDoPeriodo, ticketMedio, validarPeriodo } from './periodo'

const HOJE = '2026-10-07'

describe('validarPeriodo', () => {
  it('usa hoje quando as datas estao ausentes, sem mostrar aviso', () => {
    expect(validarPeriodo(undefined, undefined, HOJE)).toEqual({
      periodo: { de: HOJE, ate: HOJE },
      aviso: false,
    })
  })

  it('ignora datas invalidas ou invertidas e mostra aviso', () => {
    expect(validarPeriodo('2026-02-31', '2026-03-01', HOJE)).toEqual({
      periodo: { de: HOJE, ate: HOJE },
      aviso: true,
    })
    expect(validarPeriodo('2026-03-01', '2026-02-01', HOJE)).toEqual({
      periodo: { de: HOJE, ate: HOJE },
      aviso: true,
    })
    expect(validarPeriodo('abc', 'abc', HOJE)).toEqual({
      periodo: { de: HOJE, ate: HOJE },
      aviso: true,
    })
    expect(validarPeriodo('', '', HOJE)).toEqual({
      periodo: { de: HOJE, ate: HOJE },
      aviso: true,
    })
  })
})

describe('atalhos', () => {
  it('calcula Hoje, Ontem, 7 dias e Este mes a partir do dia recebido', () => {
    const opcoes = atalhos(HOJE)

    expect(opcoes.find((x) => x.rotulo === 'Hoje')?.periodo).toEqual({ de: HOJE, ate: HOJE })
    expect(opcoes.find((x) => x.rotulo === 'Ontem')?.periodo).toEqual({ de: '2026-10-06', ate: '2026-10-06' })
    expect(opcoes.find((x) => x.rotulo === '7 dias')?.periodo).toEqual({ de: '2026-10-01', ate: HOJE })
    expect(opcoes.find((x) => x.rotulo === 'Este mês')?.periodo).toEqual({ de: '2026-10-01', ate: HOJE })
  })

  it('mantem os limites corretos ao atravessar mes e ano', () => {
    expect(atalhos('2024-03-02').find((x) => x.rotulo === '7 dias')?.periodo).toEqual({
      de: '2024-02-25',
      ate: '2024-03-02',
    })
    expect(atalhos('2025-01-03').find((x) => x.rotulo === 'Este mês')?.periodo).toEqual({
      de: '2025-01-01',
      ate: '2025-01-03',
    })
  })
})

describe('diasDoPeriodo e ticketMedio', () => {
  it('conta os dias do intervalo incluindo as duas pontas', () => {
    expect(diasDoPeriodo({ de: '2026-10-01', ate: '2026-10-07' })).toBe(7)
  })

  it('calcula o ticket como total dividido pela quantidade, inclusive com zero vendas', () => {
    expect(ticketMedio(0, 0)).toBe(0)
    expect(ticketMedio(3400, 2)).toBe(1700)
    expect(ticketMedio(900 + 2500, 2)).toBe(1700)
  })
})
