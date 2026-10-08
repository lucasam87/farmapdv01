import { describe, it, expect } from 'vitest'
import {
  valorDeFiltro,
  filtroDeBuscaDeProduto,
  filtroDeBuscaDeCliente,
  filtroDeBuscaDeDevedor,
} from './postgrest'

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

// A busca de cliente NAO casa codigo de barras (nao existe): o balcao procura por
// nome, telefone ou CPF. As clausulas de telefone/CPF sao CONDICIONAIS de
// proposito: sem digitos no termo, `%%` casaria TODO cliente e a busca por nome
// devolveria a lista inteira.
describe('filtroDeBuscaDeCliente', () => {
  it('termo com digitos casa nome OU telefone OU cpf, todos entre aspas', () => {
    expect(filtroDeBuscaDeCliente('11912345678')).toBe(
      'nome.ilike."%11912345678%",telefone.ilike."%11912345678%",cpf.ilike."%11912345678%"',
    )
  })

  it('telefone pontuado e digitado pelo operador vira digito puro nas duas colunas', () => {
    expect(filtroDeBuscaDeCliente('(11) 91234-5678')).toBe(
      'nome.ilike."%(11) 91234-5678%",telefone.ilike."%11912345678%",cpf.ilike."%11912345678%"',
    )
  })

  it('termo so com letras NAO cria as clausulas vazias (nem `%%` de telefone/CPF)', () => {
    expect(filtroDeBuscaDeCliente('ANA')).toBe('nome.ilike."%ANA%"')
  })

  it('nome com virgula nao vira uma terceira condicao', () => {
    expect(filtroDeBuscaDeCliente('SILVA, MARIA')).toBe('nome.ilike."%SILVA, MARIA%"')
  })
})

// A lista de devedores do crediario le `v_clientes_devedores`, que NAO tem a
// coluna `cpf` (005:130-140). Reusar o filtro de cima poria `cpf.ilike` na
// consulta e o PostgREST recusaria tudo — a busca por telefone, que e o caso do
// balcao, devolveria "nenhum devedor". Por isso as clausulas sao nome + telefone.
describe('filtroDeBuscaDeDevedor', () => {
  it('termo com digitos casa nome OU telefone, e NUNCA menciona cpf', () => {
    expect(filtroDeBuscaDeDevedor('11912345678')).toBe(
      'nome.ilike."%11912345678%",telefone.ilike."%11912345678%"',
    )
  })

  it('telefone pontuado vira digito puro no telefone e casamento cru no nome', () => {
    expect(filtroDeBuscaDeDevedor('(11) 91234-5678')).toBe(
      'nome.ilike."%(11) 91234-5678%",telefone.ilike."%11912345678%"',
    )
  })

  it('termo so com letras NAO cria a clausula vazia de telefone', () => {
    expect(filtroDeBuscaDeDevedor('ANA')).toBe('nome.ilike."%ANA%"')
  })

  it('nome com virgula nao vira uma terceira condicao', () => {
    expect(filtroDeBuscaDeDevedor('SILVA, MARIA')).toBe('nome.ilike."%SILVA, MARIA%"')
  })
})
