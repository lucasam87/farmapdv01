import { describe, it, expect } from 'vitest'
import { lerCsv, pareceLatin1 } from './csv'

// O leitor existe porque o export do sistema antigo e um CSV brasileiro: ponto e
// virgula como separador, virgula decimal, aspas em volta de nome com separador
// dentro, e as vezes Latin-1. O erro que ele evita e usar split(';') e quebrar
// "DIPIRONA; 500mg" em duas colunas.

describe('lerCsv', () => {
  it('le ponto e virgula como separador', () => {
    const t = lerCsv('nome;preco\nDIPIRONA;4,50')
    expect(t.colunas).toEqual(['nome', 'preco'])
    expect(t.linhas).toEqual([['DIPIRONA', '4,50']])
  })
  it('le virgula como separador quando e o cabecalho', () => {
    const t = lerCsv('nome,preco\nDIPIRONA,4.50')
    expect(t.colunas).toEqual(['nome', 'preco'])
    expect(t.linhas).toEqual([['DIPIRONA', '4.50']])
  })
  it('nao quebra dentro de aspas', () => {
    const t = lerCsv('nome;preco\n"DIPIRONA; 500mg";4,50')
    expect(t.linhas[0]).toEqual(['DIPIRONA; 500mg', '4,50'])
  })
  it('aceita aspas escapadas', () => {
    const t = lerCsv('nome\n"GEL ""MENTA"""')
    expect(t.linhas[0]).toEqual(['GEL "MENTA"'])
  })
  it('preserva zeros a esquerda do codigo de barras', () => {
    const t = lerCsv('codigo;nome\n0012345;DIPIRONA')
    expect(t.linhas[0][0]).toBe('0012345')
  })
  it('ignora linha em branco no fim', () => {
    expect(lerCsv('nome\nDIPIRONA\n\n').linhas).toEqual([['DIPIRONA']])
  })
  it('remove o BOM do inicio', () => {
    expect(lerCsv('\uFEFFnome\nDIPIRONA').colunas).toEqual(['nome'])
  })
  it('aceita quebra de linha CRLF', () => {
    expect(lerCsv('nome;preco\r\nDIPIRONA;4,50\r\n').linhas).toEqual([['DIPIRONA', '4,50']])
  })
  it('preenche coluna faltante com vazio quando a linha tem menos campos', () => {
    // Planilha com linha torta nao pode desalinhar as colunas seguintes.
    const t = lerCsv('a;b;c\n1;2')
    expect(t.linhas[0]).toEqual(['1', '2', ''])
  })
  it('sem separador conhecido, a linha inteira e uma coluna', () => {
    const t = lerCsv('nome\nDIPIRONA 500mg')
    expect(t.colunas).toEqual(['nome'])
    expect(t.linhas).toEqual([['DIPIRONA 500mg']])
  })
  it('texto vazio devolve tabela vazia, sem estourar', () => {
    expect(lerCsv('')).toEqual({ colunas: [], linhas: [] })
    expect(lerCsv('   \n  ')).toEqual({ colunas: [], linhas: [] })
  })
})

describe('pareceLatin1', () => {
  it('reconhece UTF-8 valido', () => {
    expect(pareceLatin1(new TextEncoder().encode('AÇÃO'))).toBe(false)
  })
  it('reconhece Latin-1', () => {
    // "AÇÃO" em Latin-1: Ç e Ã sao um byte so (0xC7, 0xC3)
    expect(pareceLatin1(new Uint8Array([0x41, 0xc7, 0xc3, 0x4f]))).toBe(true)
  })
  it('ASCII puro nao e Latin-1', () => {
    expect(pareceLatin1(new TextEncoder().encode('DIPIRONA 500mg'))).toBe(false)
  })
})
