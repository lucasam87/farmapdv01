// O funil da importacao.
//
// CSV e XLSX sao lidos por modulos diferentes, mas desembocam na MESMA Tabela e
// daqui para a frente existe um caminho so: mapear cabecalho, descartar rodape,
// converter valores e conferir as somas. E por isso que "Excel ou CSV" nao
// viraram dois caminhos para manter.
//
// Duas coisas que este modulo protege e que valem a pena estar escritas:
//
// 1. IMPORTAR NAO E ADIVINHAR. Codigo de barras que chegou sem os zeros a
//    esquerda gera AVISO e e importado como veio. Completar zeros por conta
//    propria poderia casar com OUTRO produto — inventar codigo e pior que
//    importar um codigo que o leitor nao vai encontrar.
//
// 2. COLUNA AUSENTE != VALOR ZERO. `estoque_atual` e `null` quando a planilha
//    nao traz a coluna, e isso e o que faz a reimportacao NAO mexer no estoque
//    de quem ja esta cadastrado. Se virasse 0, reimportar preco zeraria estoque.

import { parsearCentavos } from './dinheiro'
import type { Tabela } from './csv'

export type { Tabela }

export type LinhaProduto = {
  codigo_barras: string | null
  nome: string
  categoria: string | null
  unidade: string
  preco_custo: number
  preco_venda: number
  estoque_atual: number | null
  estoque_minimo: number
  erros: string[]
}

export type ResultadoAnalise = {
  linhas: LinhaProduto[]
  faltando: string[]
  descartadas: number
  /**
   * O TOTAL que o exportador IMPRIMIU no arquivo, lido do rodape — nao a soma
   * das linhas. E o unico lado INDEPENDENTE da conferencia da spec 8.7: a soma
   * das linhas passa pelo nosso leitor, este numero passou pela aritmetica do
   * sistema antigo. `null` quando o arquivo nao traz a linha de total, ou quando
   * ela e ambigua.
   */
  totalImpresso: number | null
  /** Soma dos precos de venda que serao gravados. */
  somaGravada: number
  /**
   * true SOMENTE quando existe total impresso e ele bate ao centavo. Sem total
   * impresso isto e false de proposito: nao conferido nao e conferido.
   */
  somaConferida: boolean
  validas: number
  invalidas: number
  avisos: string[]
}

// Campos canonicos e os apelidos que cada exportador usa. A comparacao e feita
// com o cabecalho normalizado (minusculo, sem acento).
const APELIDOS: Record<string, string[]> = {
  codigo_barras: ['codigo', 'cod barras', 'codigo de barras', 'codigo barras', 'ean', 'ean13', 'barra'],
  nome: ['nome', 'produto', 'descricao', 'descricao do produto'],
  categoria: ['categoria', 'grupo', 'secao'],
  unidade: ['unidade', 'un', 'embalagem'],
  preco_custo: ['preco custo', 'custo', 'valor custo', 'vl custo', 'preco de compra'],
  preco_venda: ['preco venda', 'preco', 'valor', 'vl venda', 'preco de venda', 'pv'],
  estoque_atual: ['estoque atual', 'estoque', 'qtd', 'qtde', 'quantidade', 'saldo'],
  estoque_minimo: ['estoque minimo', 'minimo', 'estoque min', 'ponto de pedido'],
}

const OBRIGATORIO = 'nome'

export function normalizarCabecalho(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function indiceDasColunas(colunas: string[]): { mapa: Record<string, number>; faltando: string[] } {
  const normalizadas = colunas.map(normalizarCabecalho)
  const mapa: Record<string, number> = {}

  for (const [campo, apelidos] of Object.entries(APELIDOS)) {
    const indice = normalizadas.findIndex((c) => apelidos.includes(c))
    if (indice >= 0) mapa[campo] = indice
  }

  const faltando = OBRIGATORIO in mapa ? [] : [OBRIGATORIO]
  return { mapa, faltando }
}

export function detectarFormato(nomeArquivo: string, bytes: Uint8Array): 'csv' | 'xlsx' | 'desconhecido' {
  // A assinatura do conteudo vem primeiro: a extensao mente, o conteudo nao.
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx'
  if (nomeArquivo.toLowerCase().endsWith('.xlsx')) return 'desconhecido'
  if (bytes.length > 0) return 'csv'
  return 'desconhecido'
}

/** Linha de total do exportador: "TOTAL" na primeira celula e nenhuma outra letra. */
export function ehRodape(linha: string[]): boolean {
  const naoVazias = linha.filter((c) => c.trim() !== '')
  if (naoVazias.length === 0) return false

  const primeira = normalizarCabecalho(naoVazias[0])
  if (!primeira.includes('total')) return false

  // Qualquer outra celula com letra significa que e uma linha de produto de
  // verdade cujo nome comeca com "TOTAL" (ex.: "TOTAL DIPIRONA").
  return naoVazias.slice(1).every((c) => !/[a-zA-ZÀ-ÿ]/.test(c))
}

/**
 * O TOTAL impresso no rodape — o lado INDEPENDENTE da conferencia.
 *
 * Ele NAO e recalculado das linhas: e o numero que o sistema antigo imprimiu,
 * resultado da aritmetica DELE. E por isso que os dois lados podem divergir:
 * enquanto os dois saiam da mesma variavel, a conferencia da spec 8.7 era uma
 * identidade e a tarja vermelha era codigo morto.
 *
 * Quando o mapa reconhece a coluna de preco, o total e a celula dela. Sem essa
 * coluna, aceitamos a UNICA celula de dinheiro do rodape; com duas ou mais
 * (quantidade e valor, por exemplo) devolvemos null — melhor nao conferir do que
 * conferir contra o numero errado e dar o aval.
 *
 * LIMITE: o leitor de dinheiro e o mesmo dos dois lados, entao uma leitura errada
 * sistematica (um defeito dentro do proprio parsearCentavos) desloca os dois na
 * mesma direcao e nao seria acusada aqui. O que esta conferencia pega e o defeito
 * de SELECAO e de SOMATORIO: coluna trocada (somar preco de custo como venda),
 * linha perdida, linha contada duas vezes, rodape que discorda das linhas.
 */
function totalDoRodape(linha: string[], indicePreco: number | undefined): number | null {
  if (indicePreco !== undefined) {
    return parsearCentavos((linha[indicePreco] ?? '').trim())
  }

  const dinheiro = linha
    .map((c) => c.trim())
    .filter((c) => c !== '' && !/[a-zA-ZÀ-ÿ]/.test(c))
    .map((c) => parsearCentavos(c))
    .filter((v): v is number => v !== null)

  return dinheiro.length === 1 ? dinheiro[0] : null
}

/** Inteiro nao negativo, 0 a 999999. Zero e valor legitimo em estoque. */
function lerEstoque(texto: string | undefined): number | null {
  if (texto === undefined) return null
  const limpo = texto.replace(/[\s\u00A0]/g, '')
  if (limpo === '') return null
  if (!/^\d+$/.test(limpo)) return null
  const n = Number(limpo)
  if (!Number.isSafeInteger(n) || n > 999999) return null
  return n
}

function celula(linha: string[], indice: number | undefined): string | undefined {
  if (indice === undefined) return undefined
  return linha[indice]
}

function textoOuNulo(valor: string | undefined): string | null {
  if (valor === undefined) return null
  const limpo = valor.trim()
  return limpo === '' ? null : limpo
}

export function analisarTabela(tabela: Tabela): ResultadoAnalise {
  const { mapa, faltando } = indiceDasColunas(tabela.colunas)

  const linhas: LinhaProduto[] = []
  const avisos: string[] = []
  let descartadas = 0
  let totalImpresso: number | null = null
  let somaGravada = 0
  let semZeros = 0

  for (const linha of tabela.linhas) {
    if (ehRodape(linha)) {
      descartadas++
      // O primeiro rodape manda; um segundo seria anomalia do arquivo.
      if (totalImpresso === null) totalImpresso = totalDoRodape(linha, mapa.preco_venda)
      continue
    }

    const erros: string[] = []

    const nome = (celula(linha, mapa.nome) ?? '').trim()
    if (nome === '') erros.push('Informe o nome do produto.')

    const codigoTexto = textoOuNulo(celula(linha, mapa.codigo_barras))
    if (codigoTexto !== null && /^\d{5,}$/.test(codigoTexto) && !codigoTexto.startsWith('0')) {
      semZeros++
    }

    // Preco: a coluna pode nao existir (vira 0) ou existir com valor ilegivel
    // (vira erro — melhor recusar que gravar preco errado).
    let precoCusto = 0
    const custoTexto = celula(linha, mapa.preco_custo)
    if (mapa.preco_custo !== undefined) {
      const custo = parsearCentavos(custoTexto ?? '')
      if (custo === null) {
        if ((custoTexto ?? '').trim() !== '') erros.push('Preço de custo inválido.')
      } else {
        precoCusto = custo
      }
    }

    let precoVenda = 0
    const vendaTexto = celula(linha, mapa.preco_venda)
    if (mapa.preco_venda !== undefined) {
      const venda = parsearCentavos(vendaTexto ?? '')
      if (venda === null) {
        if ((vendaTexto ?? '').trim() !== '') erros.push('Preço de venda inválido.')
      } else {
        precoVenda = venda
        somaGravada += venda
      }
    }

    // Estoque: coluna ausente -> null (nao mexe); "0" -> 0 (zera de verdade).
    let estoqueAtual: number | null = null
    if (mapa.estoque_atual !== undefined) {
      estoqueAtual = lerEstoque(celula(linha, mapa.estoque_atual))
    }
    const minimo = lerEstoque(celula(linha, mapa.estoque_minimo)) ?? 0

    linhas.push({
      codigo_barras: codigoTexto,
      nome,
      categoria: textoOuNulo(celula(linha, mapa.categoria)),
      unidade: textoOuNulo(celula(linha, mapa.unidade)) ?? 'un',
      preco_custo: precoCusto,
      preco_venda: precoVenda,
      estoque_atual: estoqueAtual,
      estoque_minimo: minimo,
      erros,
    })
  }

  if (semZeros > 0) {
    avisos.push(
      `${semZeros} código(s) de barras chegaram sem zeros à esquerda. ` +
        'Confira se a coluna saiu como texto da planilha — o que veio será importado como está.',
    )
  }

  const validas = linhas.filter((l) => l.erros.length === 0).length

  return {
    linhas,
    faltando,
    descartadas,
    totalImpresso,
    somaGravada,
    somaConferida: totalImpresso !== null && totalImpresso === somaGravada,
    validas,
    invalidas: linhas.length - validas,
    avisos,
  }
}
