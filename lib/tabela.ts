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
  /**
   * `null` = o arquivo NAO disse o custo (coluna ausente, celula vazia, ou a
   * palavra "null" que o exportador do sistema antigo imprime no lugar do null do
   * banco). E diferente de 0: com `null` a RPC nao mexe no custo cadastrado.
   */
  preco_custo: number | null
  preco_venda: number
  estoque_atual: number | null
  estoque_minimo: number
  erros: string[]
}

/**
 * Quais colunas OPCIONAIS a planilha realmente trouxe.
 *
 * Isto existe porque "chave ausente != valor zero" e a regra que protege a
 * reimportacao: uma planilha só com nome e codigo de barras nao pode zerar o
 * preco de venda de quem ja esta cadastrado. Enquanto esses campos viajavam
 * sempre (com 0 quando a coluna nao existia), a RPC gravava zero por cima.
 */
export type ColunasPresentes = {
  preco_custo: boolean
  preco_venda: boolean
  estoque_minimo: boolean
}

export type ResultadoAnalise = {
  linhas: LinhaProduto[]
  faltando: string[]
  descartadas: number
  colunasPresentes: ColunasPresentes
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
   * Codigos de barras que aparecem MAIS DE UMA VEZ entre as linhas validas.
   *
   * Nao e um detalhe: a RPC `importar_produtos` recusa o arquivo INTEIRO quando
   * um codigo se repete (a segunda linha sobrescreveria a primeira em silencio —
   * caso 11 de 070_importacao.sql), e o catalogo REAL do sistema antigo tem
   * repetidos: o mesmo EAN em dois cadastros, com nomes e precos diferentes.
   * A previa avisa antes, para o dono nao descobrir isso so na recusa.
   */
  codigosRepetidos: string[]
  /**
   * Quantas linhas tinham nome e codigo de barras TROCADOS no arquivo e foram
   * corrigidas na leitura. A previa avisa: dado do dono nao se corrige calado.
   */
  invertidasCorrigidas: number
  /**
   * Quantas linhas foram DEIXADAS DE FORA por repetirem um codigo de barras.
   *
   * Decisao do Lucas (07/10/2026): o catalogo real do sistema antigo tem EAN
   * repetido, e importar so o PRIMEIRO cadastro de cada codigo e melhor do que
   * recusar o arquivo inteiro. O que ficou de fora e listado na previa, para ele
   * corrigir no Nex — nada e sobrescrito em silencio.
   */
  ignoradasPorRepeticao: number
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

/**
 * O maior valor que a coluna `integer` do Postgres aceita, em centavos.
 *
 * NAO e um limite de negocio inventado: e o limite do BANCO. O catalogo real do
 * sistema antigo tem uma linha com preco R$ 7.896.714.283,00 (cadastro
 * corrompido); em centavos isso estoura o `integer`, e como a importacao e tudo
 * ou nada, essa unica linha derrubava o catalogo INTEIRO com um erro cru do
 * Postgres. Barrando aqui, a linha ruim vira uma linha invalida nomeada na previa
 * e o resto do catalogo entra.
 */
const LIMITE_DE_CENTAVOS = 2147483647
const LIMITE_EM_REAIS = 'R$ 21.474.836,47'

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

/**
 * O exportador do sistema antigo imprimiu um valor NULO como a palavra "null"?
 *
 * Nao e um caso de teste inventado: 524 produtos do catalogo real saem assim na
 * coluna "Preço de custo". Tratar isso como "preco ilegivel" recusava 9% do
 * catalogo por causa de um dado que o proprio sistema antigo nunca teve.
 */
function ehNuloDoExportador(valor: string | undefined): boolean {
  const limpo = (valor ?? '').trim().toLowerCase()
  return limpo === '' || limpo === 'null'
}

/**
 * A celula inteira e um codigo (digitos e espacos)? O apostrofo da frente conta:
 * e como o Excel marca "isto e texto" e o exportador do sistema antigo o imprimiu.
 */
function ehSoCodigo(valor: string): boolean {
  return /^'?[\d][\d ]*$/.test(valor.trim())
}

/** Tem letra (acentuada inclusive)? Entao e texto, nao codigo. */
function temLetra(valor: string): boolean {
  return /[A-Za-zÀ-ÿ]/.test(valor)
}

export function analisarTabela(tabela: Tabela): ResultadoAnalise {
  const { mapa, faltando } = indiceDasColunas(tabela.colunas)

  const linhas: LinhaProduto[] = []
  const avisos: string[] = []
  let descartadas = 0
  let totalImpresso: number | null = null
  let somaGravada = 0
  let semZeros = 0
  let invertidasCorrigidas = 0

  for (const linha of tabela.linhas) {
    if (ehRodape(linha)) {
      descartadas++
      // O primeiro rodape manda; um segundo seria anomalia do arquivo.
      if (totalImpresso === null) totalImpresso = totalDoRodape(linha, mapa.preco_venda)
      continue
    }

    const erros: string[] = []

    let nome = (celula(linha, mapa.nome) ?? '').trim()
    let codigoTexto = textoOuNulo(celula(linha, mapa.codigo_barras))

    // CADASTRO INVERTIDO no exportador: a coluna de nome tem o codigo e a de
    // codigo tem o nome do produto. E dado real do sistema antigo (6 linhas do
    // catalogo), e inverter aqui e o unico jeito de o produto entrar certo — se o
    // dono corrigir no Nex depois, a reimportacao casa por CODIGO DE BARRAS e nao
    // acharia esta linha (o codigo dela e um nome), criando duplicata.
    //
    // A troca so acontece quando e INEQUIVOCA: um lado e so digitos e o outro tem
    // letra. Cadastro normal nao casa; codigo de fornecedor com letra ("000127-WP")
    // tambem nao, porque ai a coluna de nome tem um nome de verdade.
    if (codigoTexto !== null && ehSoCodigo(nome) && temLetra(codigoTexto)) {
      const nomeRecuperado = codigoTexto
      codigoTexto = nome.replace(/^'/, '').replace(/\s+/g, '')
      nome = nomeRecuperado
      invertidasCorrigidas++
    }

    if (nome === '') erros.push('Informe o nome do produto.')
    // Aviso de zeros a esquerda vale para codigo CURTO: e o Excel que come o zero
    // de "0012345" e ele sai "12345". Um EAN-13/14 completo NAO perdeu zero
    // nenhum, e sem o teto de 12 digitos o aviso acusava em falso os 5613 EANs do
    // catalogo real do sistema antigo (todos comecam com 7 ou 8).
    if (codigoTexto !== null && /^\d{5,12}$/.test(codigoTexto) && !codigoTexto.startsWith('0')) {
      semZeros++
    }

    // Preco de custo: a coluna pode nao existir, a celula pode vir vazia, ou pode
    // vir a PALAVRA "null" — que e como o exportador do sistema antigo imprime o
    // null do banco (524 produtos do catalogo real saem assim). Os tres casos sao
    // "nao sei o custo" e viram `null`, que faz a RPC nao mexer no custo
    // cadastrado. Um texto ilegivel de verdade continua sendo erro: melhor
    // recusar a linha do que gravar custo errado.
    let precoCusto: number | null = null
    const custoTexto = celula(linha, mapa.preco_custo)
    if (mapa.preco_custo !== undefined && !ehNuloDoExportador(custoTexto)) {
      const custo = parsearCentavos(custoTexto ?? '')
      if (custo === null) {
        if ((custoTexto ?? '').trim() !== '') erros.push('Preço de custo inválido.')
      } else if (custo > LIMITE_DE_CENTAVOS) {
        erros.push(`Preço de custo acima do limite do banco (${LIMITE_EM_REAIS}).`)
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
      } else if (venda > LIMITE_DE_CENTAVOS) {
        erros.push(`Preço de venda acima do limite do banco (${LIMITE_EM_REAIS}).`)
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

  // Codigo de barras repetido: a RPC recusa o arquivo INTEIRO por causa de um
  // repetido (caso 11 de 070_importacao.sql), e o catalogo real do sistema antigo
  // tem varios — o mesmo EAN em dois cadastros, as vezes com precos diferentes.
  // DECISAO DO LUCAS (07/10/2026): importar so o PRIMEIRO cadastro de cada codigo
  // e listar o que ficou de fora, em vez de recusar o catalogo inteiro. Nada e
  // sobrescrito em silencio, e a RPC continua recusando se um repetido escapar.
  const jaVisto = new Set<string>()
  const codigosRepetidos: string[] = []
  let ignoradasPorRepeticao = 0
  const linhasUnicas = linhas.filter((l) => {
    // Linha com erro nao chega ao banco, entao nao participa da decisao.
    if (l.erros.length > 0 || l.codigo_barras === null) return true
    if (jaVisto.has(l.codigo_barras)) {
      if (!codigosRepetidos.includes(l.codigo_barras)) codigosRepetidos.push(l.codigo_barras)
      ignoradasPorRepeticao++
      return false
    }
    jaVisto.add(l.codigo_barras)
    return true
  })

  const validas = linhasUnicas.filter((l) => l.erros.length === 0).length

  return {
    linhas: linhasUnicas,
    faltando,
    descartadas,
    colunasPresentes: {
      preco_custo: mapa.preco_custo !== undefined,
      preco_venda: mapa.preco_venda !== undefined,
      estoque_minimo: mapa.estoque_minimo !== undefined,
    },
    totalImpresso,
    somaGravada,
    somaConferida: totalImpresso !== null && totalImpresso === somaGravada,
    codigosRepetidos,
    invertidasCorrigidas,
    ignoradasPorRepeticao,
    validas,
    invalidas: linhasUnicas.length - validas,
    avisos,
  }
}
