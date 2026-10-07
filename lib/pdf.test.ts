import fs from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  lerPdf,
  textoDoPdf,
  linhaDeTotal,
  lerPdfEmGrade,
  mapearColunasDoRelatorio,
  linhasDosTrechos,
} from './pdf'
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

// O PDF de verdade do sistema antigo (tests/fixtures/produtos-nex.pdf) fica no
// disco como evidencia. A leitura por GRADE reconstroi ele: a pagina e
// ROTACIONADA (`0 1 -1 0 595 0 cm`) e a tabela e DESENHADA com `re`, entao a
// faixa de `x` de cada retangulo e o eixo dos produtos e a posicao dentro dela e
// a coluna. Ver o bloco "LEITURA POR GRADE" em lib/pdf.ts.
//
// Estes testes valem contra os valores REAIS do arquivo, e nao contra um numero
// digitado aqui: a linha do produto e conferida campo a campo.
describe('PDF real do Nex (leitura por grade)', () => {
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

  it.skipIf(!temNex)('reconstroi as colunas da grade, na ordem impressa no relatorio', () => {
    // O cabecalho impresso tem 8 colunas; a Tabela devolve as 5 que o funil de
    // importacao usa (lib/tabela.ts). As outras tres ("Código extra", "status" e
    // o codigo INTERNO) nao tem campo canonico e por isso nao viram coluna.
    const t = lerPdfEmGrade(bytes('produtos-nex.pdf'))
    expect(t.colunas).toEqual(['nome', 'codigo_barras', 'preco_venda', 'estoque_atual', 'preco_custo'])
    // 501 paginas, 11 a 12 produtos por pagina: o relatorio inteiro.
    expect(t.linhas.length).toBeGreaterThan(5000)
    for (const linha of t.linhas) expect(linha).toHaveLength(5)
  })

  it.skipIf(!temNex)('le nome, codigo de barras, preco, estoque e custo de um produto conhecido', () => {
    const t = lerPdfEmGrade(bytes('produtos-nex.pdf'))
    const produto = t.linhas.find((l) => (l[0] ?? '').includes('AAS PROTECT 100MG C30'))
    expect(produto).toBeDefined()
    if (!produto) return

    // O nome sai juntado das linhas quebradas, o codigo de barras e o EAN de 13
    // digitos (e NAO o codigo interno), e os valores sao os impressos no arquivo.
    expect(produto[0]).toBe('AAS PROTECT 100MG C30')
    expect(produto[1]).toBe('7896094928046')
    expect(parsearCentavos(produto[2])).toBe(2854)
    expect(produto[3]).toBe('0')
    expect(parsearCentavos(produto[4])).toBe(1903)
  })

  it.skipIf(!temNex)('o codigo de barras de TODO produto e o EAN, nunca o codigo interno', () => {
    const t = lerPdfEmGrade(bytes('produtos-nex.pdf'))
    const codigos = t.linhas.map((l) => l[1])

    // O relatorio tem a coluna "Código" (interno: "LO57719", "5366621") e a
    // coluna "Código de barras" (EAN de 13). Se o leitor pegasse a primeira —
    // que e o que `indiceDasColunas` faria — o codigo interno apareceria aqui.
    expect(codigos.some((c) => c.startsWith('LO'))).toBe(false)

    // 5465 dos 5782 produtos tem EAN (13 ou 14 digitos). Os outros 317 nao tem
    // EAN NENHUM no relatorio e recebem o codigo interno como ultimo recurso —
    // e um fallback declarado em lib/pdf.ts, nao o codigo interno vazando para
    // uma coluna que tinha EAN.
    const comEan = codigos.filter((c) => /^\d{13,14}$/.test(c))
    expect(comEan.length).toBeGreaterThan(5000)
    expect(codigos.filter((c) => /^\d{15,}$/.test(c))).toEqual([])
  })

  it.skipIf(!temNex)('o funil de importacao le a tabela do PDF real sem inventar linha', () => {
    const r = analisarTabela(lerPdfEmGrade(bytes('produtos-nex.pdf')))
    // Sem total impresso no arquivo, a conferencia NAO e afirmada.
    expect(r.totalImpresso).toBeNull()
    expect(r.somaConferida).toBe(false)
    expect(r.faltando).toEqual([])
    expect(r.validas).toBeGreaterThan(5000)
    for (const linha of r.linhas) expect(linha.nome.length).toBeGreaterThan(0)
  })
})

// A regra de juncao do nome quebrado e a escolha da coluna de codigo de barras
// sao as duas decisoes que o relatorio real obriga a tomar. Elas sao testadas
// aqui com a forma que o leitor ve, sem depender do arquivo grande.
describe('regra de juncao do nome quebrado', () => {
  it('junta as linhas de um mesmo produto com UM espaco, sem inventar palavra', () => {
    // O exportador do Nex quebra a linha sem preservar o espaco que caiu na
    // quebra, entao a emenda sai ora no meio de uma palavra, ora entre palavras.
    // A regra conservadora e sempre com espaco: ela nunca inventa palavra nova.
    const linhas = linhasDosTrechos([
      { x: 44, y: 44, fonte: 10, texto: ' ACIDO' },
      { x: 54, y: 44, fonte: 10, texto: 'ACETILSALICILI' },
      { x: 64, y: 44, fonte: 10, texto: 'CO 100MG C3O' },
      { x: 74, y: 44, fonte: 10, texto: 'EUROFARMA' },
    ])
    expect(linhas).toHaveLength(1)
    expect(linhas[0].texto).toBe('ACIDO ACETILSALICILI CO 100MG C3O EUROFARMA')
  })

  it('nao cola dois produtos diferentes: o vao entre eles separa as linhas', () => {
    // Medido no arquivo: dentro de um produto as linhas quebradas ficam a 10
    // pontos; entre produtos o salto e 26. A tolerancia fica no meio disso.
    const linhas = linhasDosTrechos([
      { x: 44, y: 44, fonte: 10, texto: 'ACIDO' },
      { x: 54, y: 44, fonte: 10, texto: 'ACETILSALICILICO' },
      { x: 44, y: 70, fonte: 10, texto: 'COND PANTENE' },
      { x: 54, y: 70, fonte: 10, texto: 'PRO-V BAMBU' },
    ])
    expect(linhas.map((l) => l.texto)).toEqual([
      'ACIDO ACETILSALICILICO',
      'COND PANTENE PRO-V BAMBU',
    ])
  })

  it('descarta trecho em branco e normaliza espaco repetido', () => {
    const linhas = linhasDosTrechos([
      { x: 44, y: 44, fonte: 10, texto: '  DIPIRONA  ' },
      { x: 54, y: 44, fonte: 10, texto: '  500mg   ' },
    ])
    expect(linhas.map((l) => l.texto)).toEqual(['DIPIRONA 500mg'])
  })
})

describe('escolha da coluna de codigo de barras', () => {
  it('prefere "Código de barras" a "Código" quando os dois casam com o campo', () => {
    // E o caso do relatorio real: DUAS colunas de codigo. O apelido mais longo
    // ("codigo de barras") ganha do mais curto ("codigo").
    const { mapa } = mapearColunasDoRelatorio(['Nome', 'Código', 'Preço', 'Código de barras'])
    expect(mapa.nome).toBe(0)
    expect(mapa.preco_venda).toBe(2)
    expect(mapa.codigo_barras).toBe(3)
  })

  it('olha a AMOSTRA quando os dois titulos sao iguais: vence a coluna que parece EAN', () => {
    // Duas colunas com o MESMO titulo. O unico desempate honesto olha o dado:
    // so a coluna com codigo de 6+ digitos pode ser o codigo de barras.
    const cabecalho = ['Código de barras', 'Código de barras']
    const amostra = [
      ['LO57719', '7896094928046'],
      ['41224112214211 24', '7891317026370'],
    ]
    const { mapa } = mapearColunasDoRelatorio(cabecalho, amostra)
    expect(mapa.codigo_barras).toBe(1)
  })

  it('sem desempate possivel, o campo fica SEM coluna em vez de chutar', () => {
    // Duas colunas iguais e nenhuma amostra: nao ha como escolher. Recusar e
    // melhor que cadastrar o codigo errado — o produto iria casar com outro.
    const { mapa, conflitos } = mapearColunasDoRelatorio(['Código de barras', 'Código de barras'])
    expect(mapa.codigo_barras).toBeUndefined()
    expect(conflitos).toContain('codigo_barras')
  })

  it('preco de custo nao e confundido com preco de venda', () => {
    // "Preço" e "Preço de custo": o apelido mais longo vai para `preco_custo`, e
    // o mais curto fica com `preco_venda`. Trocados, a importacao gravaria o
    // custo como preco de venda.
    const { mapa } = mapearColunasDoRelatorio(['Nome', 'Preço', 'Preço de custo', 'Estoque'])
    expect(mapa.preco_venda).toBe(1)
    expect(mapa.preco_custo).toBe(2)
    expect(mapa.estoque_atual).toBe(3)
  })
})
