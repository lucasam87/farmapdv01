import { describe, it, expect } from 'vitest'
import {
  validarDia,
  diaAnterior,
  diaSeguinte,
  rotuloDoDia,
  horaDe,
  dataHoraDe,
  resumirCanceladas,
} from './dia'

// O historico de vendas e agrupado por dia de Sao Paulo e a view ja entrega o dia
// pronto. O que estes testes cobrem e so a conta que a TELA faz em cima disso:
// ler o endereco, andar de dia para dia e montar os rotulos. Nada aqui toca banco.

const HOJE = '2026-10-07'

describe('validarDia', () => {
  it('aceita a data que veio no endereco', () => {
    expect(validarDia('2026-01-15', HOJE)).toEqual({ dia: '2026-01-15', aviso: false })
  })

  it('sem parametro e so a tela abrindo no dia de hoje, nao e erro', () => {
    expect(validarDia(undefined, HOJE)).toEqual({ dia: HOJE, aviso: false })
    expect(validarDia('', HOJE)).toEqual({ dia: HOJE, aviso: false })
  })

  it('data torta cai em hoje COM aviso', () => {
    expect(validarDia('abc', HOJE)).toEqual({ dia: HOJE, aviso: true })
    expect(validarDia('2026-1-5', HOJE)).toEqual({ dia: HOJE, aviso: true }) // sem zero a esquerda
    expect(validarDia('2026-02-31', HOJE)).toEqual({ dia: HOJE, aviso: true }) // 31 de fevereiro nao existe
    expect(validarDia('2026-13-01', HOJE)).toEqual({ dia: HOJE, aviso: true })
  })
})

describe('diaAnterior e diaSeguinte', () => {
  it('andam um dia', () => {
    expect(diaAnterior('2026-02-28')).toBe('2026-02-27')
    expect(diaSeguinte('2026-02-27')).toBe('2026-02-28')
  })

  it('viram o mes', () => {
    expect(diaAnterior('2026-03-01')).toBe('2026-02-28')
  })

  it('respeitam ano bissexto', () => {
    expect(diaAnterior('2024-03-01')).toBe('2024-02-29')
  })

  it('viram o ano', () => {
    expect(diaAnterior('2026-01-01')).toBe('2025-12-31')
    expect(diaSeguinte('2026-12-31')).toBe('2027-01-01')
  })
})

describe('rotuloDoDia', () => {
  it('a tela diz "Hoje"/"Ontem" em vez de obrigar a comparar data', () => {
    expect(rotuloDoDia('2026-10-07', HOJE)).toBe('Hoje')
    expect(rotuloDoDia('2026-10-06', HOJE)).toBe('Ontem')
  })

  it('dia mais antigo sai em DD/MM/AAAA', () => {
    expect(rotuloDoDia('2026-01-15', HOJE)).toBe('15/01/2026')
  })
})

describe('horaDe e dataHoraDe', () => {
  it('o PostgREST devolve timestamp sem fuso; aceitamos "T" e espaco', () => {
    expect(horaDe('2026-01-15T22:00:00')).toBe('22:00')
    expect(horaDe('2026-01-15 22:00:00')).toBe('22:00')
  })

  it('dataHoraDe junta dia e hora', () => {
    expect(dataHoraDe('2026-01-15T22:00:00')).toBe('15/01/2026 22:00')
  })
})

describe('resumirCanceladas', () => {
  it('sem cancelada nao ha linha de resumo', () => {
    expect(resumirCanceladas([])).toEqual({ quantidade: 0, total: 0 })
  })

  it('conta so as canceladas e soma so o dinheiro delas', () => {
    expect(
      resumirCanceladas([
        { status: 'cancelada', total: 300 },
        { status: 'concluida', total: 500 },
        { status: 'cancelada', total: 100 },
      ]),
    ).toEqual({ quantidade: 2, total: 400 })
  })
})
