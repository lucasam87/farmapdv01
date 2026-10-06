import { describe, it, expect } from 'vitest'
import { formatarMoeda, formatarData, formatarDataHora } from './format'

describe('formatarMoeda', () => {
  it('formata centavos no padrão brasileiro', () => {
    expect(formatarMoeda(123456)).toBe('R$ 1.234,56')
  })
  it('formata zero', () => {
    expect(formatarMoeda(0)).toBe('R$ 0,00')
  })
  it('formata valor negativo com o sinal antes do R$', () => {
    expect(formatarMoeda(-500)).toBe('-R$ 5,00')
  })
  it('usa ponto de milhar a partir de mil reais', () => {
    expect(formatarMoeda(100000)).toBe('R$ 1.000,00')
  })
})

describe('formatarData', () => {
  it('formata no padrão dd/mm/aaaa', () => {
    expect(formatarData('2026-10-05T12:00:00-03:00')).toBe('05/10/2026')
  })
  it('nao adianta o dia para uma venda das 22h em Sao Paulo', () => {
    // 05/10/2026 22:30 em SP = 06/10/2026 01:30 UTC
    expect(formatarData('2026-10-06T01:30:00Z')).toBe('05/10/2026')
  })
})

describe('formatarDataHora', () => {
  it('inclui a hora de Sao Paulo', () => {
    expect(formatarDataHora('2026-10-06T01:30:00Z')).toBe('05/10/2026 22:30')
  })
})
