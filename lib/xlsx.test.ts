import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { lerXlsx, colunaParaIndice } from './xlsx'
import { lerCsv } from './csv'

// As fixtures sao binarias e ficam commitadas. Elas sao geradas por
// scripts/gerar-fixtures-xlsx.py (Python + openpyxl), que NAO e dependencia do
// app: nenhuma biblioteca de planilha entra no package.json.

const fixture = (nome: string): Uint8Array =>
  new Uint8Array(fs.readFileSync(path.join('tests', 'fixtures', nome)))

describe('colunaParaIndice', () => {
  it('mapeia coluna simples', () => {
    expect(colunaParaIndice('A')).toBe(0)
    expect(colunaParaIndice('B')).toBe(1)
    expect(colunaParaIndice('Z')).toBe(25)
  })
  it('mapeia coluna dupla', () => {
    expect(colunaParaIndice('AA')).toBe(26)
    expect(colunaParaIndice('AB')).toBe(27)
  })
})

describe('lerXlsx', () => {
  it('le a planilha com preco numerico', () => {
    const t = lerXlsx(fixture('produtos.xlsx'))
    expect(t.colunas).toContain('nome')
    expect(t.linhas.length).toBe(4) // 3 produtos + a linha de preco em texto
  })
  it('preserva o codigo de barras com zeros a esquerda', () => {
    const t = lerXlsx(fixture('produtos.xlsx'))
    expect(t.linhas[0][0]).toBe('0012345')
  })
  it('le celula numerica sem passar por texto', () => {
    const t = lerXlsx(fixture('produtos.xlsx'))
    expect(Number(t.linhas[0][5])).toBe(4.5) // preco_venda
  })
  it('le acento no nome', () => {
    const t = lerXlsx(fixture('produtos.xlsx'))
    expect(t.linhas[0][1]).toBe('DIPIRONA 500mg ção')
  })
  it('le planilha com preco em texto e rodape', () => {
    const t = lerXlsx(fixture('produtos_texto.xlsx'))
    expect(t.linhas.at(-1)![0].toUpperCase()).toContain('TOTAL')
  })
  it('mapeia por cabecalho, nao por posicao', () => {
    // produtos_texto.xlsx tem as colunas em ordem diferente e uma extra no meio.
    const t = lerXlsx(fixture('produtos_texto.xlsx'))
    expect(t.colunas).toEqual(['nome', 'codigo_barras', 'observacao', 'preco_venda', 'estoque_atual'])
    expect(t.linhas[0][1]).toBe('0012345')
  })
  it('recusa arquivo que nao e xlsx', () => {
    expect(() => lerXlsx(new TextEncoder().encode('nome;preco\nDIPIRONA;4,50')))
      .toThrow(/não é uma planilha/)
  })
  it('recusa xlsx truncado', () => {
    const inteiro = fixture('produtos.xlsx')
    expect(() => lerXlsx(inteiro.slice(0, 200))).toThrow()
  })
  it('o xlsx e o csv equivalentes produzem a mesma Tabela', () => {
    const daPlanilha = lerXlsx(fixture('produtos.xlsx'))
    const doCsv = lerCsv(fs.readFileSync(path.join('tests', 'fixtures', 'produtos.csv'), 'utf8'))
    expect(daPlanilha.colunas).toEqual(doCsv.colunas)
    expect(daPlanilha.linhas).toEqual(doCsv.linhas)
  })
})
