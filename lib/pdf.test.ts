import fs from 'node:fs'
import { describe, it, expect } from 'vitest'
import { lerPdf, textoDoPdf, linhaDeTotal } from './pdf'
import { lerXlsx } from './xlsx'
import { analisarTabela } from './tabela'
import { parsearCentavos } from './dinheiro'

// A fixture e binaria e fica commitada. Ela e gerada por
// scripts/gerar-fixture-pdf.py (Python puro, PDF escrito a mao, sem reportlab e
// sem fpdf): nenhuma biblioteca de PDF entra no package.json.
//
// O que estes testes existem para provar: a Tabela reconstruida do PDF e
// IDENTICA a do .xlsx equivalente, e a soma dos precos que o leitor extraiu
// bate com o total IMPRESSO NO PDF — lido do arquivo, nunca digitado aqui.

const bytes = (nome: string): Uint8Array =>
  new Uint8Array(fs.readFileSync(new URL(`../tests/fixtures/${nome}`, import.meta.url)))

/**
 * So os dados, sem o rodape. A fixture de PDF tem a linha de TOTAL (e dela que
 * sai o total conferido); a de .xlsx nao tem, porque ela testa o caminho da
 * planilha. Tirar o rodape e o que permite comparar as duas Tabelas.
 */
function semRodape(tabela: { colunas: string[]; linhas: string[][] }) {
  return { colunas: tabela.colunas, linhas: tabela.linhas.filter((l) => !/total/i.test(l[0] ?? '')) }
}

/**
 * O total em centavos, lido do arquivo. `linhaDeTotal` devolve a LINHA inteira
 * ("TOTAL 21.39"), e o `parsearCentavos` recusa qualquer letra — de proposito,
 * porque e ele que le preco de produto. Entao o rotulo sai aqui, no teste, e o
 * que vai para o parser e o valor que estava impresso no PDF.
 */
function totalDoPdf(texto: string): number | null {
  const valor = linhaDeTotal(texto).replace(/[^\d.,]/g, ' ').trim().split(/\s+/).pop() ?? ''
  return parsearCentavos(valor)
}

describe('lerPdf', () => {
  it('reconstroi a mesma Tabela do .xlsx equivalente', () => {
    const doPdf = semRodape(lerPdf(bytes('produtos.pdf')))
    const daPlanilha = lerXlsx(bytes('produtos.xlsx'))
    expect(doPdf.colunas).toEqual(daPlanilha.colunas)
    expect(doPdf.linhas).toEqual(daPlanilha.linhas)
  })

  it('le a posicao de cada celula, nao a ordem do texto', () => {
    const t = lerPdf(bytes('produtos.pdf'))
    // Se o leitor usasse so a ordem dos `Tj`, o codigo de barras cairia na
    // primeira celula por sorte — o preco de venda, nao.
    expect(t.linhas[0][5]).toBe('4.5')
    expect(t.linhas[0][0]).toBe('0012345')
    expect(t.linhas[0][7]).toBe('5')
  })

  it('le acento e preco em texto do PDF', () => {
    const t = lerPdf(bytes('produtos.pdf'))
    expect(t.linhas[0][1]).toBe('DIPIRONA 500mg ção')
    expect(t.linhas[3][5]).toBe('4,50')
  })

  it('recusa arquivo que nao e PDF', () => {
    expect(() => lerPdf(new TextEncoder().encode('nome;preco\nDIPIRONA;4,50')))
      .toThrow(/não é um PDF/)
  })

  it('recusa PDF truncado', () => {
    expect(() => lerPdf(bytes('produtos.pdf').slice(0, 300))).toThrow(/cortado|corrompido/)
  })

  it('recusa PDF protegido por senha', () => {
    const original = Buffer.from(bytes('produtos.pdf'))
    const marca = Buffer.from('\n/Encrypt 9 0 R\n', 'latin1')
    expect(() => lerPdf(new Uint8Array(Buffer.concat([original, marca])))).toThrow(/senha/)
  })
})

describe('textoDoPdf e linhaDeTotal', () => {
  it('devolve uma linha por linha de base, de cima para baixo', () => {
    const texto = textoDoPdf(bytes('produtos.pdf'))
    const linhas = texto.split('\n')
    expect(linhas[0]).toContain('codigo_barras')
    expect(linhas[0]).toContain('estoque_minimo')
    expect(linhas.at(-1)).toMatch(/TOTAL/)
  })

  it('o total do PDF e lido do arquivo, nao digitado no teste', () => {
    expect(linhaDeTotal(textoDoPdf(bytes('produtos.pdf')))).toMatch(/TOTAL/i)
  })

  it('reclama quando nao existe linha de total', () => {
    expect(() => linhaDeTotal('nome preco\nDIPIRONA 4,50')).toThrow(/TOTAL/)
  })
})

describe('criterio de aceite', () => {
  it('a soma dos precos extraidos bate com o total impresso no PDF', () => {
    const total = totalDoPdf(textoDoPdf(bytes('produtos.pdf')))
    const r = analisarTabela(lerPdf(bytes('produtos.pdf')))
    expect(total).toBe(2589)
    expect(r.somaGravada).toBe(total)
  })
})

// O PDF de verdade do sistema antigo (tests/fixtures/produtos-nex.pdf) ficou no
// disco como evidencia da medicao do Step 1. Estes testes DOCUMENTAM o que foi
// medido — eles nao provam que a importacao funciona, provam o contrario.
//
// As tres causas, todas medidas no arquivo real:
//   1. NAO EXISTE total impresso com valor: as 16 ocorrencias de "total" sao
//      nome de produto ("TOTAL 12", "TOTALVITA", "TOTAL PTAO"). Sem total nao ha
//      contra o que conferir a soma, e o criterio de aceite nao pode ser
//      avaliado. Este e o motivo da decisao, e ele sozinho ja encerra o assunto.
//   2. A pagina e ROTACIONADA (`0 1 -1 0 595 0 cm`) e o leitor nao aplica o `cm`
//      — esta escrito como LIMITE CONHECIDO em lib/pdf.ts. Com os eixos trocados,
//      agrupar por linha de base agrupa pela coordenada errada e as colunas se
//      misturam.
//   3. O exportador QUEBRA o nome dentro da celula, em varias linhas de base
//      (" ACIDO" / "ACETILSALICILI" / "CO 100MG C3O" / "EUROFARMA"), entao
//      produto != linha fisica do PDF.
describe('PDF real do Nex (evidencia, nao aceite)', () => {
  // A evidencia pode nao estar no clone (o arquivo e grande): o teste que mede o
  // arquivo real nao pode derrubar a suite por causa disso.
  const temNex = fs.existsSync(new URL('../tests/fixtures/produtos-nex.pdf', import.meta.url))

  it.skipIf(!temNex)('o leitor abre o PDF real, nao so a fixture', () => {
    const texto = textoDoPdf(bytes('produtos-nex.pdf'))
    expect(texto).toContain('Relatório de produtos')
  })

  it.skipIf(!temNex)('a linha de total so casa com NOME DE PRODUTO, nunca com valor impresso', () => {
    // Ja existe "TOTAL" no nome de produto ("TOTAL PTAO"), e nao existe rodape
    // de total com numero. O helper devolve null em vez de inventar um valor.
    expect(totalDoPdf(textoDoPdf(bytes('produtos-nex.pdf')))).toBeNull()
  })

  it.skipIf(!temNex)('nao reconstroi coluna confiavel: o cabecalho lido e nome de produto colado', () => {
    const t = lerPdf(bytes('produtos-nex.pdf'))
    // "codigo_barras" nao e o titulo de nada: o exportador quebrou centenas de
    // nomes em varias linhas e o agrupamento por linha de base juntou todos.
    expect(t.colunas[0]?.startsWith('codigo_barras')).toBe(false)
    expect(t.colunas[0]?.length ?? 0).toBeGreaterThan(1000)
  })
})
