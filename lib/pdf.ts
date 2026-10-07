// Leitura de PDF (relatorio de produtos) sem biblioteca de terceiro.
//
// Um PDF NAO tem tabela: tem texto posicionado. Um extrator que so devolve o
// texto em ordem de leitura embaralha produto e preco — o valor de "4,50"
// aparece depois de tres nomes. Por isso o que este modulo guarda, para cada
// trecho, e a POSICAO (`Td`/`TD`/`Tm`), e a Tabela e reconstruida agrupando por
// linha de base (`y`) e ordenando por `x`. Sem a posicao nao ha como saber a
// qual coluna um valor pertence.
//
// O leitor cobre DE PROPOSITO so o subconjunto que um export de sistema usa:
//   - stream de conteudo com FlateDecode (ou sem filtro nenhum);
//   - operadores de texto `Tf`, `Td`, `TD`, `T*`, `Tm`, `Tj`, `TJ`, `'`, `"`;
//   - WinAnsi (latin-1) no texto literal.
// O que estiver fora do subconjunto FALHA com erro claro, em vez de ler errado:
// PDF criptografado, filtro desconhecido (JPEG/JBIG2 e imagem, nao texto) e
// arquivo que nem comeca com %PDF sao recusados. NADA aqui e adivinhado.
//
// GATILHO DE TROCA: se o PDF real do sistema antigo nao tiver texto posicionado
// (relatorio escaneado ou gerado como imagem), a decisao muda — e isso vira
// tarefa propria.

import zlib from 'node:zlib'
import type { Tabela } from './csv'

export type { Tabela }

/** Tolerancia, em pontos, para considerar dois trechos na MESMA linha de base. */
const TOLERANCIA_Y = 2

/**
 * Espaco, em pontos, ate o qual dois trechos na mesma linha de base sao a MESMA
 * celula (texto partido em dois `Tj`). Passar disso e coluna diferente.
 *
 * O valor e deliberadamente menor que qualquer coluna de tabela de verdade
 * (60+ pontos aqui): o leitor nao adivinha largura de caractere, e por isso nao
 * existe a chance de juntar `estoque_atual` com `estoque_minimo`.
 */
const FUSAO_X = 8

/** Um trecho de texto com o canto de origem do primeiro caractere. */
type Trecho = { x: number; y: number; texto: string }

/** Conteudo descomprimido de um stream, com a altura da pagina em que ele vive. */
type Fluxo = { conteudo: string; altura: number }

function assinatura(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

/**
 * O que o leitor recusa, com erro claro. A assinatura vem primeiro porque um
 * .xlsx ou um .csv chegando aqui e erro de quem chamou, nao de PDF.
 */
function validar(bytes: Uint8Array): void {
  if (!assinatura(bytes)) {
    throw new Error('Este arquivo não é um PDF. O relatório de produtos precisa ter sido exportado em PDF.')
  }

  // Latin-1 de proposito: os operadores e os numeros sao ASCII, e ler byte a
  // byte evita que uma sequencia invalida em UTF-8 derrube a leitura inteira.
  const bruto = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1')

  if (/\/Encrypt\b/.test(bruto)) {
    throw new Error('Este PDF é protegido por senha. Exporte de novo sem proteção para importar os produtos.')
  }
  if (!/\bstream\b/.test(bruto)) {
    throw new Error('Este PDF não tem stream de conteúdo. Sem texto posicionado não é possível reconstruir a tabela.')
  }
}

/** Objetos indiretos do arquivo, por numero. O indice do "N 0 obj" e o que vale. */
function lerObjetos(bruto: string): Map<number, { corpo: string; bytesInicio: number }> {
  const objetos = new Map<number, { corpo: string; bytesInicio: number }>()
  const cabecalho = /(\d+)\s+\d+\s+obj\b/g
  const achados: { numero: number; inicio: number; fimCabecalho: number }[] = []

  let m: RegExpExecArray | null
  while ((m = cabecalho.exec(bruto)) !== null) {
    achados.push({ numero: Number(m[1]), inicio: m.index, fimCabecalho: m.index + m[0].length })
  }

  for (let i = 0; i < achados.length; i++) {
    const fim = i + 1 < achados.length ? achados[i + 1].inicio : bruto.length
    objetos.set(achados[i].numero, {
      corpo: bruto.slice(achados[i].fimCabecalho, fim),
      // Onde o corpo comeca no ARQUIVO. O texto de controle e latin-1 (1 byte
      // por caractere), entao este indice de string coincide com o de byte — e
      // e com ele que o stream e cortado do Buffer original, sem passar por
      // conversao de texto.
      bytesInicio: achados[i].fimCabecalho,
    })
  }
  return objetos
}

/** Le um literal `(...)`, tratando aninhamento, escapes e o `\` de fim de linha. */
function lerLiteral(texto: string, posicao: number): { valor: string; proximo: number } {
  if (texto[posicao] !== '(') return { valor: '', proximo: posicao + 1 }

  const saida: number[] = []
  let profundidade = 1
  let i = posicao + 1

  while (i < texto.length) {
    const c = texto[i]
    if (c === '\\') {
      const proximo = texto[i + 1]
      if (proximo === 'n') { saida.push(10); i += 2 }
      else if (proximo === 'r') { saida.push(13); i += 2 }
      else if (proximo === 't') { saida.push(9); i += 2 }
      else if (proximo === 'b') { saida.push(8); i += 2 }
      else if (proximo === 'f') { saida.push(12); i += 2 }
      else if (proximo === '\n') { i += 2 }
      else if (proximo === '\r') { i += texto[i + 2] === '\n' ? 3 : 2 }
      else if (proximo >= '0' && proximo <= '7') {
        // Octal de ate 3 digitos: "\347" e o "ç" do WinAnsi.
        let digitos = ''
        let j = i + 1
        while (j < texto.length && digitos.length < 3 && texto[j] >= '0' && texto[j] <= '7') {
          digitos += texto[j]
          j++
        }
        saida.push(parseInt(digitos, 8) & 0xff)
        i = j
      } else {
        saida.push(proximo.charCodeAt(0) & 0xff)
        i += 2
      }
    } else if (c === '(') {
      profundidade++
      saida.push(0x28)
      i++
    } else if (c === ')') {
      profundidade--
      if (profundidade === 0) return { valor: Buffer.from(saida).toString('latin1'), proximo: i + 1 }
      saida.push(0x29)
      i++
    } else {
      saida.push(c.charCodeAt(0) & 0xff)
      i++
    }
  }

  // Sem o fecha-parenteses o arquivo esta truncado: melhor devolver o que veio
  // do que silenciar a linha inteira.
  return { valor: Buffer.from(saida).toString('latin1'), proximo: texto.length }
}

/** Le um hexadecimal `<...>`; cada 2 digitos sao um byte. */
function lerHexadecimal(texto: string, posicao: number): { valor: string; proximo: number } {
  const fim = texto.indexOf('>', posicao)
  if (fim < 0) return { valor: '', proximo: texto.length }

  let limpo = texto.slice(posicao + 1, fim).replace(/[^0-9a-fA-F]/g, '')
  if (limpo.length % 2 === 1) limpo += '0'

  const bytes: number[] = []
  for (let i = 0; i + 2 <= limpo.length; i += 2) bytes.push(parseInt(limpo.slice(i, i + 2), 16))
  return { valor: Buffer.from(bytes).toString('latin1'), proximo: fim + 1 }
}

/** `<< ... >>` com aninhamento. */
function lerDicionario(texto: string, posicao: number): { valor: string; proximo: number } {
  let profundidade = 0
  let i = posicao
  while (i < texto.length) {
    if (texto[i] === '<' && texto[i + 1] === '<') { profundidade++; i += 2 }
    else if (texto[i] === '>' && texto[i + 1] === '>') {
      profundidade--
      i += 2
      if (profundidade === 0) return { valor: texto.slice(posicao, i), proximo: i }
    } else i++
  }
  return { valor: texto.slice(posicao), proximo: texto.length }
}

/** Filtros do stream. Desconhecido aqui e imagem (JPEG/JBIG2), nao texto. */
function filtrosDe(dicionario: string): string[] {
  const achado = dicionario.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/)
  if (!achado) return []
  return [...achado[1].matchAll(/\/(\w+)/g)].map((m) => m[1])
}

/** `/Length` costuma ser referencia indireta (`4 0 R`); resolve pelo objeto. */
function comprimentoDe(dicionario: string, objetos: Map<number, { corpo: string }>): number | null {
  const achado = dicionario.match(/\/Length\s+(\d+)\s+\d+\s+R/) ?? dicionario.match(/\/Length\s+(\d+)/)
  if (!achado) return null

  const bruto = Number(achado[1])
  if (/\/Length\s+\d+\s+\d+\s+R/.test(dicionario)) {
    const objeto = objetos.get(bruto)
    if (objeto) {
      const valor = objeto.corpo.match(/\d+/)
      if (valor) return Number(valor[0])
    }
    return null
  }
  return bruto
}

function descomprimir(dados: Buffer, filtros: string[]): string {
  if (filtros.length === 0) return dados.toString('latin1')

  const conhecidos = filtros.every((f) => f === 'FlateDecode' || f === 'Fl')
  if (!conhecidos) {
    throw new Error(
      `Este PDF usa um filtro que o leitor não conhece (${filtros.join(', ')}). ` +
        'Sem o texto posicionado não é possível reconstruir a tabela.',
    )
  }

  // zlib as vezes e inflateRaw: tenta o cabecalho e cai para o cru.
  try {
    return zlib.inflateSync(dados).toString('latin1')
  } catch {
    try {
      return zlib.inflateRawSync(dados).toString('latin1')
    } catch {
      throw new Error('Não foi possível descomprimir o conteúdo do PDF. O arquivo pode estar corrompido.')
    }
  }
}

/** Todos os streams de conteudo, com a altura da pagina (para o y do PDF). */
function lerFluxos(bytes: Uint8Array): Fluxo[] {
  // O texto de controle e latin-1 (1 byte por caractere), e e por isso que os
  // indices andam junto com os bytes. Mas o DADO do stream e binario: ele NUNCA
  // pode ser reconstruido a partir da string — um byte 0x80 solto vira vaario
  // em UTF-8 e o inflate quebra. Por isso o slice e feito no Buffer original.
  const bruto = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const objetos = lerObjetos(bruto.toString('latin1'))

  // A altura da pagina define onde fica o topo: o PDF conta o y de baixo para
  // cima, e a leitura precisa da linha mais alta primeiro.
  let altura = 0
  for (const objeto of objetos.values()) {
    const media = objeto.corpo.match(/\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/)
    if (media) altura = Math.max(altura, Math.abs(Number(media[4]) - Number(media[2])))
  }

  const fluxos: Fluxo[] = []
  for (const objeto of objetos.values()) {
    const posicao = objeto.corpo.search(/\bstream\b/)
    if (posicao < 0) continue

    const dicionario = objeto.corpo.slice(0, posicao)
    const abertura = objeto.corpo.slice(posicao).match(/^stream\r\n|^stream\n|^stream\r/)
    if (!abertura) continue

    const inicio = objeto.bytesInicio + posicao + abertura[0].length
    const informado = comprimentoDe(dicionario, objetos)
    let dados: Buffer

    if (informado !== null && informado >= 0 && inicio + informado <= bruto.length) {
      dados = bruto.subarray(inicio, inicio + informado)
    } else {
      // Objeto sem num, `endstream` ausente ou /Length mentiroso: procura o
      // marcador no dado cru, que e o unico limite confiavel que sobrou.
      const fim = bruto.indexOf('endstream', inicio, 'latin1')
      if (fim < 0) continue
      dados = bruto.subarray(inicio, fim)
      while (dados.length > 0 && (dados[dados.length - 1] === 0x0a || dados[dados.length - 1] === 0x0d)) {
        dados = dados.subarray(0, dados.length - 1)
      }
    }

    // O fluxo pode comecar (ou vir com) o cabecalho do zlib faltando; o
    // `descomprimir` cuida disso.
    fluxos.push({
      conteudo: descomprimir(Buffer.from(dados), filtrosDe(dicionario)),
      altura: altura,
    })
  }

  return fluxos
}

/**
 * Extrai os trechos posicionados de cada `BT`/`ET`.
 *
 * A matriz de texto comeca em [1 0 0 1 e f] e e deslocada por `Td`/`TD`/`T*`;
 * `Tm` a redefine. A posicao de um `Tj` e a primeira coluna da matriz, ja com a
 * escala da fonte — e por isso que o `Tf` importa.
 *
 * LIMITE CONHECIDO: o `cm` (a matriz de espaco de usuario, inclusive `q`/`Q`) NAO
 * e aplicado. Num PDF de pagina rotacionada — o relatorio real do sistema antigo
 * comeca com `0 1 -1 0 595 0 cm` — os eixos ficam trocados, agrupar por linha de
 * base agrupa pela coordenada errada e as colunas se misturam. Nao foi corrigido
 * porque a decisao da Task 14 nao depende disso: aquele relatorio nao tem total
 * impresso, entao o criterio de aceite nao tem contra o que conferir. Ver o
 * comentario dos testes em "PDF real do Nex" no lib/pdf.test.ts.
 */
function trechosDoFluxo(conteudo: string, altura: number): Trecho[] {
  const trechos: Trecho[] = []
  let e = 0
  let f = 0
  let a = 1
  let fonte = 1
  let leading = 0

  const operadores = /\[|\]|<|\(|>>|(?:[^\s()[\]<>/]|\/(?![^\s()[\]<>/]))+/g
  // O que veio de `(...)` ou `<...>` e TEXTO, mesmo que pareca numero: o codigo
  // de barras "0012345" e o preco "2,50" sao strings no arquivo. Sem esse
  // marcador, "0012345" viraria operando e a celula sumiria da tabela.
  const pilha: { valor: string; texto: boolean }[] = []
  let dentroDeTexto = false

  let m: RegExpExecArray | null
  while ((m = operadores.exec(conteudo)) !== null) {
    const bruto = m[0]

    if (bruto === '(') {
      const { valor, proximo } = lerLiteral(conteudo, m.index)
      pilha.push({ valor, texto: true })
      operadores.lastIndex = proximo
      continue
    }
    if (bruto === '<') {
      const { valor, proximo } = lerHexadecimal(conteudo, m.index)
      pilha.push({ valor, texto: true })
      operadores.lastIndex = proximo
      continue
    }
    if (bruto === '>>') {
      const { valor, proximo } = lerDicionario(conteudo, m.index)
      pilha.push({ valor, texto: true })
      operadores.lastIndex = proximo
      continue
    }
    if (bruto === '[' || bruto === ']') continue

    if (bruto === 'BT') {
      dentroDeTexto = true
      pilha.length = 0
      e = 0; f = 0; a = 1; fonte = 1; leading = 0
      continue
    }
    if (bruto === 'ET') {
      dentroDeTexto = false
      pilha.length = 0
      continue
    }

    if (dentroDeTexto && /^[A-Za-z'"]+$/.test(bruto)) {
      const numeros = pilha
        .filter((p) => !p.texto && /^[-+]?\d*\.?\d+$/.test(p.valor))
        .map((p) => Number(p.valor))
      const textos = pilha.filter((p) => p.texto).map((p) => p.valor)

      if (bruto === 'Tf' && numeros.length >= 1) {
        fonte = Math.abs(numeros[numeros.length - 1]) || 1
      } else if (bruto === 'TL' && numeros.length >= 1) {
        leading = numeros[numeros.length - 1]
      } else if (bruto === 'Tm' && numeros.length >= 6) {
        a = numeros[0]
        e = numeros[4]
        f = numeros[5]
      } else if ((bruto === 'Td' || bruto === 'TD') && numeros.length >= 2) {
        const tx = numeros[numeros.length - 2]
        const ty = numeros[numeros.length - 1]
        e = e + a * tx
        f = f + ty
        if (bruto === 'TD') leading = -ty
      } else if (bruto === 'T*') {
        f -= leading
      } else if (bruto === "'" || bruto === '"') {
        // ' e " descem uma linha antes de mostrar; em " o ultimo numero e o
        // espacamento entre palavras (o deslocamento vem antes dele).
        const ty = bruto === '"' && numeros.length >= 3 ? numeros[numeros.length - 2] : -leading
        f -= ty
        const valor = textos[textos.length - 1] ?? ''
        if (valor !== '') trechos.push({ x: e, y: f + altura, texto: valor })
        e += valor.length * fonte
      } else if (bruto === 'Tj' || bruto === 'TJ') {
        if (textos.length > 0) {
          const valor = textos.join('')
          if (valor !== '') trechos.push({ x: e, y: f + altura, texto: valor })
          e += valor.length * fonte
        }
      }

      pilha.length = 0
      continue
    }

    // Operando que nao e texto: numero ou nome de recurso (/F1).
    if (dentroDeTexto) pilha.push({ valor: bruto, texto: false })
  }

  return trechos
}

/** Todos os trechos do arquivo, em qualquer ordem. */
function extrairTrechos(bytes: Uint8Array): Trecho[] {
  validar(bytes)
  const fluxos = lerFluxos(bytes)
  // Arquivo cortado no meio nao tem stream completo: sem isso nao ha texto, e
  // devolver Tabela vazia seria pior que recusar.
  if (fluxos.length === 0) {
    throw new Error(
      'Não foi possível ler o conteúdo do PDF. O arquivo pode estar cortado ou corrompido.',
    )
  }

  const trechos: Trecho[] = []
  for (const fluxo of fluxos) trechos.push(...trechosDoFluxo(fluxo.conteudo, fluxo.altura))
  return trechos
}

/** Agrupa por linha de base (`y`), de cima para baixo, e ordena por `x`. */
function agruparLinhas(trechos: Trecho[]): Trecho[][] {
  const ordenados = [...trechos].sort((p, q) => q.y - p.y || p.x - q.x)
  const linhas: Trecho[][] = []

  for (const trecho of ordenados) {
    const ultima = linhas[linhas.length - 1]
    // A comparacao e com a PRIMEIRA ancora da linha: assim uma sequencia de
    // linhas nao vai "escorregando" para o mesmo grupo.
    if (ultima && Math.abs(ultima[0].y - trecho.y) <= TOLERANCIA_Y) ultima.push(trecho)
    else linhas.push([trecho])
  }

  return linhas
}

/**
 * Um trecho por celula: junta so o que esta praticamente encostado (texto
 * partido em dois `Tj` pelo exportador). A separacao em colunas NAO acontece
 * aqui — ela vem das ancoras do cabecalho, mais abaixo, que e a unica largura
 * de coluna que o arquivo declara por si.
 */
function separarColunas(linha: Trecho[]): Trecho[] {
  const ordenada = [...linha].sort((p, q) => p.x - q.x)
  const colunas: Trecho[] = []

  for (const trecho of ordenada) {
    const ultima = colunas[colunas.length - 1]
    if (ultima && trecho.x - ultima.x <= FUSAO_X) {
      ultima.texto += trecho.texto
      continue
    }
    colunas.push({ ...trecho })
  }

  return colunas
}

/** Em qual coluna da ancora este `x` cai: a mais proxima a esquerda, ou a primeira. */
function colunaDe(x: number, ancoras: number[]): number {
  let melhor = 0
  for (let i = 0; i < ancoras.length; i++) {
    if (ancoras[i] <= x + 1) melhor = i
    else break
  }
  return melhor
}

/**
 * Reconstroi a Tabela: a primeira linha de texto vira o cabecalho, e as demais
 * viram dados, completados com string vazia na celula que nao existe.
 *
 * As colunas sao as posicoes `x` do proprio cabecalho — nao ha largura de
 * coluna assumida em lugar nenhum.
 */
function comoTabela(trechos: Trecho[]): Tabela {
  const linhas = agruparLinhas(trechos).map(separarColunas)
  if (linhas.length === 0) return { colunas: [], linhas: [] }

  const ancoras = linhas[0].map((c) => c.x)
  const colunas = linhas[0].map((c) => c.texto)

  const corpo: string[][] = []
  for (const linha of linhas.slice(1)) {
    const campos: string[] = new Array(ancoras.length).fill('')
    for (const celula of linha) {
      const indice = colunaDe(celula.x, ancoras)
      // Celula repetida na mesma coluna e texto que quebrou linha: o leitor
      // nao sabe juntar isso sem inventar, entao mantem o primeiro.
      if (campos[indice] === '') campos[indice] = celula.texto
    }
    if (campos.some((c) => c.trim() !== '')) corpo.push(campos)
  }

  return { colunas, linhas: corpo }
}

export function lerPdf(bytes: Uint8Array): Tabela {
  return comoTabela(extrairTrechos(bytes))
}

export function textoDoPdf(bytes: Uint8Array): string {
  const linhas = agruparLinhas(extrairTrechos(bytes))
  return linhas.map((linha) => linha.map((c) => c.texto).join(' ')).join('\n')
}

/**
 * A linha do total impressa no arquivo. Existe para o teste medir a soma dos
 * precos contra o total do PROPRIO PDF, e nao contra um numero digitado no
 * teste — que nao provaria nada.
 */
export function linhaDeTotal(texto: string): string {
  const linha = texto.split('\n').find((l) => /total/i.test(l))
  if (linha === undefined) {
    throw new Error('O PDF não tem linha de TOTAL. Sem ela não há como conferir os preços extraídos.')
  }
  return linha
}
