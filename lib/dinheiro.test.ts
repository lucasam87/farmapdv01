import { describe, it, expect } from 'vitest'
import { parsearCentavos, parsearQuantidade } from './dinheiro'

// Este módulo le o que o usuario DIGITA (balcao, importacao de planilha).
// O lib/format.ts faz o caminho contrario (centavos -> texto de exibicao) e nao
// muda por causa disto.

describe('parsearCentavos', () => {
  it('le virgula decimal', () => {
    expect(parsearCentavos('4,50')).toBe(450)
  })
  it('le ponto decimal', () => {
    expect(parsearCentavos('4.50')).toBe(450)
  })
  it('le ponto de milhar com virgula decimal', () => {
    expect(parsearCentavos('1.234,56')).toBe(123456)
  })
  it('le centavos sem separador como reais inteiros', () => {
    expect(parsearCentavos('4')).toBe(400)
  })
  it('aceita o cifrao e espacos', () => {
    expect(parsearCentavos(' R$ 4,50 ')).toBe(450)
  })
  it('aceita o espaco nao-quebraval do Intl', () => {
    // O Intl separa "R$" do numero com U+00A0; o que o usuario cola pode vir assim.
    expect(parsearCentavos('R$\u00A04,50')).toBe(450)
  })
  it('recusa texto', () => {
    expect(parsearCentavos('abc')).toBeNull()
  })
  it('recusa dois separadores decimais', () => {
    expect(parsearCentavos('4,5,0')).toBeNull()
  })
  it('recusa vazio e nulo', () => {
    expect(parsearCentavos('')).toBeNull()
    expect(parsearCentavos('   ')).toBeNull()
    expect(parsearCentavos(null as unknown as string)).toBeNull()
    expect(parsearCentavos(undefined as unknown as string)).toBeNull()
  })
  it('recusa valor acima do inteiro exato do JavaScript', () => {
    // Acima de 2^53 o Number() arredonda e a soma em centavos mentiria. O banco so
    // aceita ate 2147483647 de qualquer forma; recusar aqui e melhor que gravar um
    // valor arredondado em silencio. `parsearQuantidade` ja recusava; faltava aqui.
    expect(parsearCentavos('999999999999999999')).toBeNull()
    expect(parsearCentavos('99999999999999999999')).toBeNull()
  })
  it('NAO recusa o que ainda e exato: 2^53 - 92 centavos', () => {
    // O contrapeso da guarda acima: o maior reais que ainda cabe exato em centavos.
    // Sem este caso, um limite apertado demais passaria despercebido.
    expect(parsearCentavos('90071992547409')).toBe(9007199254740900)
  })
  it('recusa negativo', () => {
    expect(parsearCentavos('-1')).toBeNull()
  })
  it('recusa letra O no lugar do zero (erro de digitacao comum)', () => {
    expect(parsearCentavos('4,5O')).toBeNull()
  })
  it('trata ponto sem decimais como milhar, nao como decimal', () => {
    // "1.234" com tres casas nao pode ser decimal: 1234 reais.
    expect(parsearCentavos('1.234')).toBe(123400)
  })
  it('nao perde centavo por ponto flutuante', () => {
    expect(parsearCentavos('0,07')).toBe(7)
    expect(parsearCentavos('19,99')).toBe(1999)
    expect(parsearCentavos('1234567,89')).toBe(123456789)
  })
})

describe('parsearQuantidade', () => {
  it('le inteiro simples', () => {
    expect(parsearQuantidade('7')).toBe(7)
  })
  it('aceita os limites 1 e 9999', () => {
    expect(parsearQuantidade('1')).toBe(1)
    expect(parsearQuantidade('9999')).toBe(9999)
  })
  it('recusa fracionario', () => {
    expect(parsearQuantidade('1.5')).toBeNull()
  })
  it('recusa zero, negativo e acima do limite', () => {
    expect(parsearQuantidade('0')).toBeNull()
    expect(parsearQuantidade('-1')).toBeNull()
    expect(parsearQuantidade('10000')).toBeNull()
  })
  it('recusa texto, vazio e nulo', () => {
    expect(parsearQuantidade('abc')).toBeNull()
    expect(parsearQuantidade('')).toBeNull()
    expect(parsearQuantidade(null as unknown as string)).toBeNull()
  })
  it('ignora espacos em volta', () => {
    expect(parsearQuantidade(' 12 ')).toBe(12)
  })
})
