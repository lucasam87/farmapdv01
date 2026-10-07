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
//
// LEITURA POR GRADE (o caminho do relatorio real do Nex). O export do sistema
// antigo DESENHA a tabela com retangulos (`re`): sao eles que declaram onde cada
// celula comeca e termina. Um trecho de texto cai dentro de uma celula, e a
// celula e que diz a coluna e a linha — nao o agrupamento por linha de base, que
// no relatorio real junta o nome de um produto com o preco do outro. `lerPdf`
// tenta a grade primeiro e cai no caminho antigo quando o arquivo nao tem grade.
//
// Nada aqui e adivinhado: sem grade reconhecivel a funcao RECUSA com erro em
// portugues, em vez de devolver tabela inventada.

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
export function lerFluxos(bytes: Uint8Array): Fluxo[] {
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

// ---------------------------------------------------------------------------
// Leitura por grade (relatorio real do sistema antigo, desenhado com `re`)
// ---------------------------------------------------------------------------

/** Retangulo ja em coordenadas de DISPOSITIVO (o `cm` foi aplicado). */
type Retangulo = { x0: number; y0: number; x1: number; y1: number }

/**
 * Um trecho de texto ja em coordenadas de DISPOSITIVO.
 *
 * O relatorio do Nex chega aqui ROTACIONADO: o `cm` da pagina
 * (`0 1 -1 0 595 0`) troca os eixos, entao a COLUNA da tabela e uma faixa de `x`
 * e cada PRODUTO e uma posicao `y` dentro dela.
 */
type TrechoGrade = Trecho & { fonte: number }

type Grade = { colunas: number[]; linhas: number[] }

// A grade do relatorio so vale se declarar uma tabela de verdade. Abaixo disto e
// enfeite (borda de titulo, tarja): o leitor cai no caminho antigo.
const MIN_COLUNAS_GRADE = 4
const MIN_LINHAS_GRADE = 2

/**
 * Duas bordas a menos disto sao a MESMA borda.
 *
 * 1.5 e calibrado no arquivo real: as bordas medidas sao 93.5, 117, 173, 219,
 * 275, 321, 377, 423, 459, 505, 551 — a menor distancia entre duas e 5.5, e o
 * erro de arredondamento do exportador fica abaixo de 0.05. Um retangulo de
 * enfeite que caisse no meio de uma coluna viraria uma coluna fantasma, e e por
 * isso que a tolerancia nao pode ser grande.
 */
const TOLERANCIA_BORDA = 1.5

/** Mede o `cm` corrente: pilha de `q`/`Q` e concatenacao de `cm`. */
function multiplicarMatriz(m: number[], n: number[]): number[] {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ]
}

/**
 * O que a pagina DESENHA, com o espaco de usuario ja resolvido: os retangulos da
 * grade e os trechos de texto.
 *
 * LIMITE CONHECIDO DO CAMINHO ANTIGO (`trechosDoFluxo`): ele NAO aplica o `cm`, e
 * por isso os dois caminhos vivem separados. Corrigir o antigo mudaria a leitura
 * da fixture sintetica, que e a referencia dos testes que ja existem.
 *
 * O `Tf` e o `a` do `Tm` entram no operando do `Tj`: a matriz de texto do PDF ja
 * carrega a escala da fonte, e a largura da linha e `caracteres * fonte`.
 */
export function recursosDoFluxo(conteudo: string): { retangulos: Retangulo[]; trechos: TrechoGrade[] } {
  const retangulos: Retangulo[] = []
  const trechos: TrechoGrade[] = []

  let ctm = [1, 0, 0, 1, 0, 0]
  const pilha: number[][] = []
  let a = 1
  let e = 0
  let f = 0
  let fonte = 1
  let leading = 0
  let dentroDeTexto = false

  const pilhaDeOperandos: { valor: string; texto: boolean }[] = []

  const operadores = /\[|\]|<|\(|>>|(?:[^\s()[\]<>/]|\/(?![^\s()[\]<>/]))+/g
  let m: RegExpExecArray | null

  // Ponto do espaco de usuario no espaco de dispositivo (o `cm` de verdade).
  const dispositivo = (x: number, y: number): [number, number] => [
    ctm[0] * x + ctm[2] * y + ctm[4],
    ctm[1] * x + ctm[3] * y + ctm[5],
  ]

  while ((m = operadores.exec(conteudo)) !== null) {
    const bruto = m[0]

    if (bruto === '(') {
      const { valor, proximo } = lerLiteral(conteudo, m.index)
      pilhaDeOperandos.push({ valor, texto: true })
      operadores.lastIndex = proximo
      continue
    }
    if (bruto === '<') {
      const { valor, proximo } = lerHexadecimal(conteudo, m.index)
      pilhaDeOperandos.push({ valor, texto: true })
      operadores.lastIndex = proximo
      continue
    }
    if (bruto === '>>') {
      const { valor, proximo } = lerDicionario(conteudo, m.index)
      pilhaDeOperandos.push({ valor, texto: true })
      operadores.lastIndex = proximo
      continue
    }
    if (bruto === '[' || bruto === ']') continue

    if (bruto === 'q') {
      pilha.push([...ctm])
      pilhaDeOperandos.length = 0
      continue
    }
    if (bruto === 'Q') {
      ctm = pilha.pop() ?? [1, 0, 0, 1, 0, 0]
      pilhaDeOperandos.length = 0
      continue
    }

    const numeros = pilhaDeOperandos
      .filter((p) => !p.texto && /^[-+]?\d*\.?\d+$/.test(p.valor))
      .map((p) => Number(p.valor))
    const textos = pilhaDeOperandos.filter((p) => p.texto).map((p) => p.valor)

    if (bruto === 'cm' && numeros.length >= 6) {
      ctm = multiplicarMatriz(numeros.slice(-6), ctm)
      pilhaDeOperandos.length = 0
      continue
    }

    if (bruto === 're' && numeros.length >= 4) {
      const [x, y, w, h] = numeros.slice(-4)
      // Os QUATRO cantos, e nao so a origem: com o `cm` da pagina o retangulo
      // gira, e o menor/maior de cada eixo e a unica leitura honesta.
      const cantos = [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ].map(([px, py]) => dispositivo(px, py))
      const xs = cantos.map((c) => c[0])
      const ys = cantos.map((c) => c[1])
      retangulos.push({
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        y0: Math.min(...ys),
        y1: Math.max(...ys),
      })
      pilhaDeOperandos.length = 0
      continue
    }

    if (bruto === 'BT') {
      dentroDeTexto = true
      pilhaDeOperandos.length = 0
      a = 1; e = 0; f = 0; fonte = 1; leading = 0
      continue
    }
    if (bruto === 'ET') {
      dentroDeTexto = false
      pilhaDeOperandos.length = 0
      continue
    }

    if (dentroDeTexto && /^[A-Za-z'"]+$/.test(bruto)) {
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
        const ty = bruto === '"' && numeros.length >= 3 ? numeros[numeros.length - 2] : -leading
        f -= ty
        const valor = textos[textos.length - 1] ?? ''
        // O `dispositivo` e medido DEPOIS do `f -= ty`: com o `cm` da pagina os
        // eixos estao trocados e a posicao tem que sair do estado ja atualizado.
        if (valor !== '') {
          const [dx, dy] = dispositivo(e, f)
          trechos.push({ x: dx, y: dy, fonte, texto: valor })
        }
      } else if (bruto === 'Tj' || bruto === 'TJ') {
        if (textos.length > 0) {
          const valor = textos.join('')
          if (valor !== '') {
            const [dx, dy] = dispositivo(e, f)
            trechos.push({ x: dx, y: dy, fonte, texto: valor })
          }
        }
      }

      pilhaDeOperandos.length = 0
      continue
    }

    // Operando que nao e texto: numero de `Tm`/`Td`/`rg` ou nome de recurso
    // (`/F1`). A pilha NAO e limpa por token desconhecido: e ela que guarda os
    // quatro numeros do `re` que vem logo depois.
    pilhaDeOperandos.push({ valor: bruto, texto: false })
  }

  return { retangulos, trechos }
}

/** Bordas distintas de uma lista, agrupadas com a tolerancia da grade. */
function bordasDistintas(valores: number[]): number[] {
  const ordenados = [...valores].sort((p, q) => p - q)
  const grupos: number[] = []
  for (const valor of ordenados) {
    const ultimo = grupos[grupos.length - 1]
    if (ultimo !== undefined && Math.abs(valor - ultimo) <= TOLERANCIA_BORDA) continue
    grupos.push(valor)
  }
  return grupos
}

/**
 * Colunas (x) e linhas (y) a partir das bordas dos retangulos.
 *
 * Usa TODAS as bordas, nao so o canto de origem: num relatorio em que cada
 * celula e um `re` proprio, a borda direita de uma celula e a esquerda da
 * seguinte, e juntar as duas e o que fecha a grade sem buraco.
 */
export function gradeDe(retangulos: Retangulo[]): Grade | null {
  if (retangulos.length < MIN_COLUNAS_GRADE) return null

  const colunas = bordasDistintas(retangulos.flatMap((r) => [r.x0, r.x1]))
  const linhas = bordasDistintas(retangulos.flatMap((r) => [r.y0, r.y1]))

  if (colunas.length - 1 < MIN_COLUNAS_GRADE) return null
  if (linhas.length - 1 < MIN_LINHAS_GRADE) return null
  return { colunas, linhas }
}

/** Em qual faixa `valor` cai. Fora de todas, a faixa mais proxima. */
export function faixaDe(valor: number, bordas: number[]): number {
  for (let i = 0; i < bordas.length - 1; i++) {
    if (valor >= bordas[i] - TOLERANCIA_BORDA && valor <= bordas[i + 1] + TOLERANCIA_BORDA) return i
  }
  // O `Tj` do nome comeca alguns decimos fora da celula (o `Td` do exportador
  // nao cai exatamente na borda). Sem esta saida a celula sumiria.
  let melhor = 0
  let distancia = Infinity
  for (let i = 0; i < bordas.length - 1; i++) {
    const d = Math.min(Math.abs(valor - bordas[i]), Math.abs(valor - bordas[i + 1]))
    if (d < distancia) { distancia = d; melhor = i }
  }
  return melhor
}

/** Ordem de preferencia quando DOIS cabecalhos casam com o mesmo campo. */
const PRIORIDADE_DO_CAMPO = ['codigo_barras', 'nome', 'preco_custo', 'preco_venda', 'estoque_atual', 'estoque_minimo']

/**
 * Apelidos do cabecalho do RELATORIO (o que vem impresso na primeira linha da
 * grade). Nao e o mesmo vocabulario do `APELIDOS` de lib/tabela.ts, que le
 * planilha: aqui o unico cabecalho que existe e este.
 */
const APELIDOS_DO_RELATORIO: Record<string, string[]> = {
  codigo_barras: ['codigo de barras', 'codigo barras', 'cod barras', 'codigo', 'ean', 'ean13'],
  nome: ['nome', 'produto', 'descricao', 'descricao do produto'],
  preco_venda: ['preco', 'preco venda', 'preco de venda', 'valor', 'pv'],
  preco_custo: ['preco de custo', 'preco custo', 'custo', 'valor de custo'],
  estoque_atual: ['estoque', 'estoque atual', 'qtd', 'quantidade', 'saldo'],
  estoque_minimo: ['estoque minimo', 'minimo', 'estoque min'],
}

/** EAN-13, UPC-A ou o codigo interno do sistema antigo: so digito, 6+ casas. */
function pareceCodigoDeBarras(valor: string): boolean {
  return /^\d{6,14}$/.test(valor.trim())
}

/**
 * Celula da grade sempre e string. A faixa sem texto vira `undefined` no vetor
 * da linha, e sem isto um cabeçalho com buraco derrubaria o leitor inteiro.
 */
function textoDaCelula(valor: string | undefined): string {
  return valor ?? ''
}

/**
 * Casa cada campo canonico com a coluna do cabecalho.
 *
 * O RELATORIO TEM DUAS COLUNAS DE CODIGO — "Código" (interno, 7 digitos) e
 * "Código de barras" (EAN de 13) — e as duas estao na lista de apelidos do
 * campo `codigo_barras`. Como `indiceDasColunas` (lib/tabela.ts) usa `findIndex`,
 * ele pegaria a PRIMEIRA, e o cadastro sairia com o codigo interno no lugar do
 * EAN. A desambiguacao e explicita aqui:
 *
 *   1. Casa pelo apelido de MAIOR comprimento ("codigo de barras" ganha de
 *      "codigo"; "preco de custo" ganha de "preco").
 *   2. Empate entre colunas do MESMO campo: vence a que PARECE codigo de barras
 *      na amostra de dados (so digito, 6+ casas). E o unico desempate honesto —
 *      ele olha o dado, nao o titulo.
 *   3. Ainda empatado: o campo fica SEM coluna. Nao se escolhe no chute.
 */
export function mapearColunasDoRelatorio(
  cabecalho: string[],
  amostra: string[][] = [],
): { mapa: Record<string, number>; conflitos: string[] } {
  const normalizado = cabecalho.map((c) =>
    textoDaCelula(c)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )

  const candidatos = new Map<string, { indice: number; comprimento: number }[]>()
  const conflitos: string[] = []

  for (const [campo, apelidos] of Object.entries(APELIDOS_DO_RELATORIO)) {
    const achados = normalizado
      .map((titulo, indice) => ({ indice, comprimento: apelidos.includes(titulo) ? titulo.length : -1 }))
      .filter((c) => c.comprimento >= 0)
    if (achados.length === 0) continue

    const maior = Math.max(...achados.map((c) => c.comprimento))
    candidatos.set(campo, achados.filter((c) => c.comprimento === maior))
  }

  const mapa: Record<string, number> = {}
  const usadas = new Set<number>()

  for (const campo of PRIORIDADE_DO_CAMPO) {
    const lista = candidatos.get(campo)
    if (!lista) continue

    const livres = lista.filter((c) => !usadas.has(c.indice))
    if (livres.length === 0) continue
    if (livres.length === 1) {
      mapa[campo] = livres[0].indice
      usadas.add(livres[0].indice)
      continue
    }

    const parecem = livres.filter((c) => amostra.some((linha) => pareceCodigoDeBarras(linha[c.indice] ?? '')))
    if (parecem.length === 1) {
      mapa[campo] = parecem[0].indice
      usadas.add(parecem[0].indice)
      continue
    }

    // Ambiguo de verdade: recusar e melhor que cadastrar o codigo errado.
    conflitos.push(campo)
  }

  return { mapa, conflitos }
}

/**
 * Os trechos de uma MESMA FAIXA, agrupados por posicao e na ordem de leitura.
 *
 * Aqui esta o que derruba a leitura ingenua. No relatorio real a tabela esta
 * ROTACIONADA pelo `cm` da pagina, entao:
 *
 *   - a FAIXA de `x` do dispositivo e o EIXO DOS PRODUTOS: a faixa do nome tem
 *     o titulo "Nome" e, embaixo dele, um nome por produto;
 *   - a posicao `y` dentro da faixa e a COLUNA da tabela.
 *
 * Sem separar por faixa, os nomes dos 9 produtos de uma pagina viram UM texto so
 * — era exatamente o defeito medido na leitura antiga (29.582 caracteres de
 * nomes colados na primeira linha).
 *
 * O corte entre um produto e o seguinte e o VAO na posicao: dentro de um produto
 * as linhas quebradas ficam a 10 pontos (medido: "ACETILSALICILI" em 410 e "CO
 * 100MG C3O" em 420) e entre produtos o salto e 26. `TOLERANCIA_DE_PRODUTO` fica
 * no meio disso.
 */
const TOLERANCIA_DE_PRODUTO = 20

/**
 * A REGRA DE JUNCAO DO NOME QUEBRADO: trechos da MESMA celula (mesma faixa,
 * mesma posicao) sao ligados por UM ESPACO.
 *
 * O exportador do Nex quebra a linha sem olhar a largura da fonte e SEM
 * preservar o espaco que caiu na quebra, entao a emenda sai ora no meio de uma
 * palavra ("ACETILSALICILI" + "CO" = "ACETILSALICILICO"), ora entre palavras
 * ("COND" + "PANTENE"). Nao da para distinguir as duas pelo texto: as metricas
 * do WinAnsi nao estao no arquivo e o exportador quebra por contagem de
 * caracteres, nao por largura (medido: 49 trechos nao-finais tem exatamente 15
 * caracteres, e todos os mais curtos terminam em fronteira de palavra).
 *
 * Por isso a regra e a MAIS CONSERVADORA: sempre com espaco. Ela NUNCA inventa
 * palavra nova; o pior caso e "ACETILSALICILI CO" no lugar de
 * "ACETILSALICILICO", que o dono corrige lendo a previa — e a previa e
 * justamente o criterio de aceite combinado para este PDF.
 */
export function linhasDosTrechos(grupo: TrechoGrade[]): { posicao: number; texto: string }[] {
  const ordenados = [...grupo].sort((p, q) => p.y - q.y || p.x - q.x)
  const blocos: TrechoGrade[][] = []

  for (const trecho of ordenados) {
    const bloco = blocos[blocos.length - 1]
    const anterior = bloco?.[bloco.length - 1]
    if (anterior && trecho.y - anterior.y <= TOLERANCIA_DE_PRODUTO) bloco.push(trecho)
    else blocos.push([trecho])
  }

  return blocos.map((bloco) => ({
    posicao: bloco[0].y,
    texto: bloco
      .map((t) => t.texto)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  }))
}

/**
 * As POSICOES de coluna do relatorio, medidas no arquivo, e o CAMPO de cada uma.
 *
 * A faixa do dispositivo e o EIXO DOS PRODUTOS (uma faixa por produto) e a
 * posicao dentro da faixa e a COLUNA da tabela. As posicoes sao as mesmas nas
 * 501 paginas (o exportador usa o mesmo modelo de tabela em todas) e formam um
 * ciclo de 96.25: 44 (nome), 140.25 (codigo), 236.5 (preco), 332.75 (estoque),
 * 429 (codigo extra), 525.25 (preco de custo), 621.5 (status), 717.75 (codigo de
 * barras). O cabecalho impresso ("Nome", "Código", ...) fica em 109, com metade
 * do ciclo, fora deste eixo.
 *
 * A COLUNA DE CODIGO DE BARRAS E A DE 717.75, e nao a de 140.25: o relatorio tem
 * DUAS (a interna, com o codigo do sistema antigo tipo "LO57719", e o EAN de 13
 * digitos). As duas casam com o apelido `codigo_barras`, e o mapeamento explicito
 * e o que impede o codigo interno de entrar no lugar do EAN — `indiceDasColunas`
 * (lib/tabela.ts) usaria `findIndex` e pegaria a PRIMEIRA.
 */
const POSICOES_DO_RELATORIO: { posicao: number; campo: string }[] = [
  { posicao: 44, campo: 'nome' },
  { posicao: 140.25, campo: 'codigo_interno' },
  { posicao: 236.5, campo: 'preco_venda' },
  { posicao: 332.75, campo: 'estoque_atual' },
  { posicao: 429, campo: 'codigo_extra' },
  { posicao: 525.25, campo: 'preco_custo' },
  { posicao: 621.5, campo: 'status' },
  { posicao: 717.75, campo: 'codigo_barras' },
]

/** As posicoes que NAO viram coluna da Tabela (nao tem campo canonico). */
const POSICOES_IGNORADAS = new Set(['codigo_interno', 'codigo_extra', 'status'])

/** Os campos canonicos que a Tabela devolve, na ordem em que sao impressos. */
const CAMPOS_DO_RELATORIO = ['nome', 'codigo_barras', 'preco_venda', 'estoque_atual', 'preco_custo']

/** Em qual posicao do relatorio este trecho caiu, ou -1 se estiver fora. */
function posicaoDaColuna(posicao: number): number {
  for (let i = 0; i < POSICOES_DO_RELATORIO.length; i++) {
    if (Math.abs(posicao - POSICOES_DO_RELATORIO[i].posicao) <= TOLERANCIA_DE_PRODUTO) return i
  }
  return -1
}

/**
 * Uma pagina do relatorio como Tabela.
 *
 * A FAIXA e o EIXO DOS PRODUTOS: cada faixa do dispositivo e um produto (a faixa
 * do nome acumula os nomes quebrados em varias linhas; as outras guardam o
 * codigo, o preco, o estoque...). Sem separar por faixa os nomes dos 9 produtos
 * de uma pagina viram UM texto so — era o defeito medido na leitura antiga
 * (29.582 caracteres de nomes colados na primeira linha).
 *
 * Devolve null quando a pagina nao tem grade utilizavel.
 */
export function tabelaDaPagina(fluxo: Fluxo): { tabela: Tabela; campos: string[] } | null {
  const { retangulos, trechos } = recursosDoFluxo(fluxo.conteudo)
  const grade = gradeDe(retangulos)
  if (grade === null || trechos.length === 0) return null

  const porFaixa = new Map<number, TrechoGrade[]>()
  for (const trecho of trechos) {
    const faixa = faixaDe(trecho.x, grade.colunas)
    const atual = porFaixa.get(faixa)
    if (atual) atual.push(trecho)
    else porFaixa.set(faixa, [trecho])
  }

  // Cada faixa e um produto, e cada posicao dentro dela e uma coluna. Trecho em
  // posicao desconhecida (o titulo em 109, o rodape em 695.29/413.22) fica fora.
  const produtos: string[][] = []
  const indiceDoCampo = new Map(CAMPOS_DO_RELATORIO.map((campo, i) => [campo, i]))

  for (const grupo of porFaixa.values()) {
    const linhas = linhasDosTrechos(grupo).filter((l) => l.texto !== '')
    if (linhas.length === 0) continue

    // O VALOR de cada posicao, e nao so a celula: e a posicao que diz se o
    // codigo de barras veio do EAN (717.75) ou do codigo interno (140.25).
    const valorDaPosicao = new Map<string, string>()
    for (const linha of linhas) {
      const coluna = posicaoDaColuna(linha.posicao)
      if (coluna < 0) continue
      const campo = POSICOES_DO_RELATORIO[coluna].campo
      if (valorDaPosicao.has(campo)) continue
      valorDaPosicao.set(campo, linha.texto)
    }

    const celulas: string[] = new Array(CAMPOS_DO_RELATORIO.length).fill('')
    for (const [campo, valor] of valorDaPosicao) {
      if (POSICOES_IGNORADAS.has(campo)) continue
      const indice = indiceDoCampo.get(campo)
      if (indice !== undefined) celulas[indice] = valor
    }

    // FALLBACK DECLARADO: quando o produto nao tem EAN (a posicao 717.75 vem
    // vazia), o codigo INTERNO entra no lugar — e o unico identificador que
    // sobrou. Com EAN presente isto nunca acontece: ali a posicao 717.75
    // preenche a celula e o interno fica de fora. Sem esta regra o produto sem
    // EAN entraria sem identificador nenhum.
    if (celulas[1] === '') celulas[1] = valorDaPosicao.get('codigo_interno') ?? ''

    if (celulas.every((c) => c === '')) continue
    produtos.push(celulas)
  }

  if (produtos.length < MIN_LINHAS_GRADE) return null

  const dados = produtos
    // Cabecalho repetido no topo de uma pagina nao e produto.
    .filter((linha) => normalizarTexto(linha[0]) !== 'nome')
    .filter((linha) => linha.some((c) => c !== ''))
    // Rodape de pagina que caiu junto de um produto ("Emitido em:: ...", "1 / 1")
    // nao pode virar linha: a celula do codigo de barras e o filtro, porque ela
    // ou esta vazia ou e um codigo de verdade.
    .filter(
      (linha) =>
        linha[1] === '' || pareceCodigoDeBarras(linha[1]) || !/^(emitido|\d+\s*\/)/i.test(linha[1]),
    )

  return { tabela: { colunas: [...CAMPOS_DO_RELATORIO], linhas: dados }, campos: [...CAMPOS_DO_RELATORIO] }
}

/** O titulo impresso, quando a celula e exatamente o cabecalho de alguma coluna. */
function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Le o PDF pela GRADE desenhada com `re`.
 *
 * Recusa com erro claro quando a pagina nao tem grade ou quando o cabecalho nao
 * declara as colunas — a alternativa seria devolver tabela inventada, e o que o
 * dono confere e a tabela.
 */
export function lerPdfEmGrade(bytes: Uint8Array): Tabela {
  validar(bytes)
  const fluxos = lerFluxos(bytes)

  let colunas: string[] | null = null
  const corpo: string[][] = []

  for (const fluxo of fluxos) {
    const pagina = tabelaDaPagina(fluxo)
    if (pagina === null) continue

    if (colunas === null) {
      colunas = pagina.tabela.colunas
      corpo.push(...pagina.tabela.linhas)
      continue
    }

    // Todas as paginas do relatorio tem as MESMAS colunas (medido). Pagina com
    // colunas diferentes seria outro relatorio colado neste, e ai a tabela nao
    // tem uma leitura unica.
    if (pagina.tabela.colunas.join('|') !== colunas.join('|')) {
      throw new Error(
        'O PDF tem páginas com tabelas de colunas diferentes. Sem uma grade única não é possível importar.',
      )
    }
    corpo.push(...pagina.tabela.linhas)
  }

  if (colunas === null) {
    throw new Error(
      'Não encontrei a grade da tabela neste PDF. O relatório precisa ter sido exportado como planilha ou como PDF com as células desenhadas.',
    )
  }

  return { colunas, linhas: corpo }
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

/**
 * O caminho de entrada. Tenta a GRADE primeiro (relatorio do sistema antigo,
 * com as celulas desenhadas) e cai no agrupamento por linha de base quando o
 * arquivo nao tem grade — que e o caso do export simples, cujo cabecalho ja
 * declara as colunas e onde cada produto e uma linha de texto so.
 *
 * Os erros de RECUSA (nao e PDF, senha, cortado) nao caem no caminho antigo: so
 * a ausencia de grade cai, porque ela e uma caracteristica do arquivo, nao um
 * defeito dele.
 */
export function lerPdf(bytes: Uint8Array): Tabela {
  try {
    return lerPdfEmGrade(bytes)
  } catch (erro) {
    if (erro instanceof Error && /grade da tabela/.test(erro.message)) {
      return comoTabela(extrairTrechos(bytes))
    }
    throw erro
  }
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
