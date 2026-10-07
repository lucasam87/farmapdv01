import fs from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  detectarFormato,
  normalizarCabecalho,
  indiceDasColunas,
  ehRodape,
  analisarTabela,
} from './tabela'
import { lerXlsx } from './xlsx'

// Este modulo e o funil: CSV e XLSX desembocam na mesma Tabela e daqui para a
// frente existe UM caminho so. O que ele protege:
//   - cabecalho de exportador varia ("Codigo de Barras", "Cod. Barras", "EAN");
//   - planilha de sistema termina com uma linha TOTAL, que nao e produto;
//   - "nao veio a coluna de estoque" e DIFERENTE de "veio estoque 0" — e isso
//     que faz a reimportacao nao zerar o estoque de quem ja esta cadastrado.

describe('normalizarCabecalho', () => {
  it('tira acento, caixa, underscore e espacos das pontas', () => {
    expect(normalizarCabecalho('  Descrição_ ')).toBe('descricao')
    expect(normalizarCabecalho('VL VENDA')).toBe('vl venda')
  })
})

describe('indiceDasColunas', () => {
  it('mapeia apelidos de cabecalho sem acento e com espacos', () => {
    const { mapa } = indiceDasColunas(['Codigo de Barras', 'Descrição', 'VL VENDA', 'Qtde'])
    expect(mapa.codigo_barras).toBe(0)
    expect(mapa.nome).toBe(1)
    expect(mapa.preco_venda).toBe(2)
    expect(mapa.estoque_atual).toBe(3)
  })
  it('aponta o campo obrigatorio que falta', () => {
    expect(indiceDasColunas(['codigo', 'preco']).faltando).toEqual(['nome'])
  })
  it('nao reclama quando o obrigatorio existe', () => {
    expect(indiceDasColunas(['nome', 'preco']).faltando).toEqual([])
  })
})

describe('ehRodape', () => {
  it('reconhece rodape de total', () => {
    expect(ehRodape(['TOTAL', '', '', '', '1234.56'])).toBe(true)
    expect(ehRodape(['Total geral', '', ''])).toBe(true)
    expect(ehRodape(['DIPIRONA', '', '4,50'])).toBe(false)
  })
  it('produto com TOTAL no nome e categoria nao e rodape', () => {
    expect(ehRodape(['TOTAL DIPIRONA', 'Analgésico', '4,50'])).toBe(false)
  })
})

describe('detectarFormato', () => {
  it('detecta formato por assinatura', () => {
    expect(detectarFormato('x.xlsx', new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('xlsx')
    expect(detectarFormato('x.csv', new TextEncoder().encode('nome;preco'))).toBe('csv')
    expect(detectarFormato('x.xlsx', new TextEncoder().encode('nome;preco'))).toBe('desconhecido')
  })
  it('a assinatura vence a extensao', () => {
    // Arquivo com conteudo de planilha e nome .txt: o conteudo manda.
    expect(detectarFormato('x.txt', new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('xlsx')
  })
})

describe('analisarTabela', () => {
  it('le preco numerico e preco em texto com o mesmo resultado', () => {
    const a = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['DIPIRONA', '4.5']] })
    const b = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['DIPIRONA', '4,50']] })
    expect(a.linhas[0].preco_venda).toBe(450)
    expect(b.linhas[0].preco_venda).toBe(450)
  })
  it('descarta o rodape em vez de contar como linha invalida', () => {
    const r = analisarTabela({
      colunas: ['nome', 'preco'],
      linhas: [['DIPIRONA', '4,50'], ['TOTAL', '4,50']],
    })
    expect(r.validas).toBe(1)
    expect(r.descartadas).toBe(1)
    expect(r.invalidas).toBe(0)
  })
  it('nome vazio vira linha invalida nomeada', () => {
    const r = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['', '4,50']] })
    expect(r.invalidas).toBe(1)
    expect(r.linhas[0].erros[0]).toContain('nome')
  })
  it('preco ilegivel vira linha invalida, nao zero', () => {
    const r = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['DIPIRONA', '4,5O']] })
    expect(r.invalidas).toBe(1)
    expect(r.linhas[0].preco_venda).toBe(0)
  })
  it('codigo vazio vira null', () => {
    const r = analisarTabela({ colunas: ['nome', 'codigo'], linhas: [['DIPIRONA', '']] })
    expect(r.linhas[0].codigo_barras).toBeNull()
  })
  it('preserva zeros a esquerda do codigo', () => {
    const r = analisarTabela({ colunas: ['nome', 'codigo'], linhas: [['DIPIRONA', '0012345']] })
    expect(r.linhas[0].codigo_barras).toBe('0012345')
    expect(r.avisos).toEqual([])
  })
  it('avisa quando o codigo chegou sem zeros a esquerda', () => {
    const r = analisarTabela({ colunas: ['nome', 'codigo'], linhas: [['DIPIRONA', '12345']] })
    expect(r.avisos.join(' ')).toContain('zeros')
  })
  // A conferencia da spec 8.7 so existe se os dois lados forem INDEPENDENTES: um
  // e a soma das linhas que o NOSSO leitor extraiu, o outro e o TOTAL que o
  // sistema antigo IMPRIMIU no rodape do arquivo. Enquanto os dois lados saiam da
  // mesma variavel, esta conferencia era uma identidade e nunca acusava nada.
  it('acusa divergencia entre a soma das linhas e o TOTAL impresso no arquivo', () => {
    const r = analisarTabela({
      colunas: ['nome', 'preco'],
      linhas: [['A', '4,50'], ['B', '5,50'], ['TOTAL', '12,00']],
    })
    expect(r.totalImpresso).toBe(1200)
    expect(r.somaGravada).toBe(1000)
    expect(r.somaConferida).toBe(false)
  })
  it('marca a soma como conferida quando o TOTAL impresso bate com as linhas', () => {
    const r = analisarTabela({
      colunas: ['nome', 'preco'],
      linhas: [['A', '4,50'], ['B', '5,50'], ['TOTAL', '10,00']],
    })
    expect(r.totalImpresso).toBe(1000)
    expect(r.somaGravada).toBe(1000)
    expect(r.somaConferida).toBe(true)
  })
  it('sem linha de TOTAL nao afirma que conferiu', () => {
    const r = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['A', '4,50']] })
    expect(r.totalImpresso).toBeNull()
    expect(r.somaConferida).toBe(false)
  })
  it('o TOTAL impresso e lido do arquivo, nao recalculado das linhas', () => {
    // Se o TOTAL saisse da soma das linhas, este caso daria 2739 e "conferiria".
    const r = analisarTabela({
      colunas: ['nome', 'preco'],
      linhas: [['A', '4,50'], ['B', '5,50'], ['TOTAL', '21,39']],
    })
    expect(r.totalImpresso).toBe(2139)
  })
  it('rodape ambiguo, sem coluna de preco reconhecida, devolve null em vez de escolher', () => {
    // Duas celulas de dinheiro e nenhuma coluna que o mapa reconheca como preco:
    // melhor nao conferir do que conferir contra o numero errado.
    const r = analisarTabela({
      colunas: ['nome', 'coluna_a', 'coluna_b'],
      linhas: [['A', '2', '4,50'], ['TOTAL', '2', '4,50']],
    })
    expect(r.totalImpresso).toBeNull()
  })
  it('sem coluna de preco reconhecida, o unico valor do rodape serve de total', () => {
    const r = analisarTabela({
      colunas: ['nome', 'coluna_a'],
      linhas: [['A', '4,50'], ['TOTAL', '4,50']],
    })
    expect(r.totalImpresso).toBe(450)
  })
  it('estoque 0 e VALOR, e nao ausencia de coluna', () => {
    const r = analisarTabela({ colunas: ['nome', 'estoque'], linhas: [['A', '0']] })
    expect(r.linhas[0].estoque_atual).toBe(0)
    expect(r.linhas[0].erros).toEqual([])
    expect(r.invalidas).toBe(0)
  })
  it('coluna de estoque ausente vira null (nao mexe no estoque de quem existe)', () => {
    const r = analisarTabela({ colunas: ['nome'], linhas: [['A']] })
    expect(r.linhas[0].estoque_atual).toBeNull()
  })
  it('estoque com texto ilegivel vira null sem invalidar a linha', () => {
    const r = analisarTabela({ colunas: ['nome', 'estoque'], linhas: [['A', 'dez']] })
    expect(r.linhas[0].estoque_atual).toBeNull()
    expect(r.invalidas).toBe(0)
  })
  it('estoque minimo vazio vira 0', () => {
    const r = analisarTabela({ colunas: ['nome', 'minimo'], linhas: [['A', '']] })
    expect(r.linhas[0].estoque_minimo).toBe(0)
  })
  it('unidade vazia vira un e categoria vazia vira null', () => {
    const r = analisarTabela({ colunas: ['nome', 'unidade', 'categoria'], linhas: [['A', '', '']] })
    expect(r.linhas[0].unidade).toBe('un')
    expect(r.linhas[0].categoria).toBeNull()
  })
  it('aponta o campo obrigatorio que falta e nao valida linha nenhuma', () => {
    const r = analisarTabela({ colunas: ['codigo', 'preco'], linhas: [['1', '4,50']] })
    expect(r.faltando).toEqual(['nome'])
    expect(r.validas).toBe(0)
  })
})

describe('analisarTabela com o arquivo do exportador', () => {
  // A fixture tem rodape TOTAL ("21,39") e tres produtos (4,50 + 6,90 + 9,99).
  // Aqui a conferencia da spec 8.7 roda de ponta a ponta no formato real, nao numa
  // Tabela montada a mao.
  function tabelaDe(nome: string) {
    return lerXlsx(new Uint8Array(fs.readFileSync(new URL(`../tests/fixtures/${nome}`, import.meta.url))))
  }

  it('confere a soma das linhas contra o TOTAL impresso no arquivo', () => {
    const r = analisarTabela(tabelaDe('produtos_texto.xlsx'))
    expect(r.totalImpresso).toBe(2139)
    expect(r.somaGravada).toBe(2139)
    expect(r.somaConferida).toBe(true)
  })

  it('sem linha de TOTAL no arquivo, nao afirma que conferiu', () => {
    const r = analisarTabela(tabelaDe('produtos.xlsx'))
    expect(r.totalImpresso).toBeNull()
    expect(r.somaConferida).toBe(false)
  })
})
