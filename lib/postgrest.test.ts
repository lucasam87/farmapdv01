import { describe, it, expect } from 'vitest'
import { valorDeFiltro, filtroDeBuscaDeProduto } from './postgrest'

// O filtro do PostgREST e uma string montada por concatenacao: virgula separa
// condicoes e parentese abre/fecha grupo. Um termo do balcao com esses caracteres
// quebrava a busca — nome de medicamento com virgula e comum.

describe('valorDeFiltro', () => {
  it('entrega o valor entre aspas duplas', () => {
    expect(valorDeFiltro('DIPIRONA')).toBe('"DIPIRONA"')
  })

  it('a virgula fica DENTRO das aspas, e nao separando condicoes', () => {
    expect(valorDeFiltro('DIPIRONA, 20')).toBe('"DIPIRONA, 20"')
  })

  it('o parentese fica dentro das aspas', () => {
    expect(valorDeFiltro('DIPIRONA (20mg)')).toBe('"DIPIRONA (20mg)"')
  })

  it('escapa a aspa dupla, que e o unico caractere ainda especial', () => {
    expect(valorDeFiltro('DIPIRONA "20"')).toBe('"DIPIRONA \\"20\\""')
  })

  it('escapa a barra invertida antes de escapar a aspa', () => {
    expect(valorDeFiltro('a\\b')).toBe('"a\\\\b"')
    expect(valorDeFiltro('a\\"b')).toBe('"a\\\\\\"b"')
  })
})

describe('filtroDeBuscaDeProduto', () => {
  it('monta codigo exato OU pedaco do nome, os dois entre aspas', () => {
    expect(filtroDeBuscaDeProduto('999000111')).toBe(
      'codigo_barras.eq."999000111",nome.ilike."%999000111%"',
    )
  })

  it('um termo com virgula nao cria uma terceira condicao', () => {
    // A virgula do termo vai DENTRO das aspas, entao o PostgREST le duas
    // condicoes — `codigo_barras.eq."DIPIRONA, 20"` e `nome.ilike."%DIPIRONA, 20%"`.
    expect(filtroDeBuscaDeProduto('DIPIRONA, 20')).toBe(
      'codigo_barras.eq."DIPIRONA, 20",nome.ilike."%DIPIRONA, 20%"',
    )
  })
})
