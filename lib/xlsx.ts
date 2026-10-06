// Leitura de .xlsx sem biblioteca de terceiro.
//
// Um .xlsx e um ZIP de XML, e o Node ja traz o que falta (zlib). A decisao de
// nao instalar SheetJS/ExcelJS e deliberada: e exatamente o caminho onde um erro
// custa caro (preco de medicamento), e o leitor caseiro e pequeno e restrito.
//
// O leitor cobre DE PROPOSITO so o subconjunto que um export de sistema usa:
//   - a primeira planilha;
//   - valores diretos (<v>) e textos compartilhados (sharedStrings);
//   - texto embutido (inlineStr);
//   - nada de formula, nada de data, nada de .xls binario antigo.
// O que estiver fora do subconjunto FALHA com erro claro, em vez de ler errado.
//
// GATILHO DE TROCA: se o arquivo real do sistema antigo nao for lido por este
// leitor, a decisao muda para `read-excel-file` — e isso vira tarefa propria.

import zlib from 'node:zlib'
import type { Tabela } from './csv'

const EOCD = 0x06054b50 // fim do central directory
const CENTRAL = 0x02014b50 // entrada do central directory

/** 'A' -> 0, 'Z' -> 25, 'AA' -> 26, 'AB' -> 27. */
export function colunaParaIndice(letras: string): number {
  let indice = 0
  for (let i = 0; i < letras.length; i++) {
    indice = indice * 26 + (letras.charCodeAt(i) - 64)
  }
  return indice - 1
}

function desescaparXml(texto: string): string {
  return texto
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Le o ZIP pelo central directory (a partir do fim) e devolve cada entrada ja descomprimida. */
function lerZip(bytes: Uint8Array): Map<string, Buffer> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // Procurar o EOCD do fim para o comeco: assim uma sequencia PK que apareca
  // dentro dos dados descomprimidos nao confunde o leitor.
  let eocd = -1
  const limite = Math.max(0, buffer.length - 66000)
  for (let i = buffer.length - 22; i >= limite; i--) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) {
    throw new Error('Não foi possível ler a planilha. O arquivo pode estar corrompido ou protegido por senha.')
  }

  const total = buffer.readUInt16LE(eocd + 10)
  let cursor = buffer.readUInt32LE(eocd + 16)
  const entradas = new Map<string, Buffer>()

  for (let n = 0; n < total; n++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL) {
      throw new Error('Não foi possível ler a planilha. O arquivo pode estar corrompido ou protegido por senha.')
    }
    const metodo = buffer.readUInt16LE(cursor + 10)
    const tamanhoComprimido = buffer.readUInt32LE(cursor + 20)
    const tamanhoNome = buffer.readUInt16LE(cursor + 28)
    const tamanhoExtra = buffer.readUInt16LE(cursor + 30)
    const tamanhoComentario = buffer.readUInt16LE(cursor + 32)
    const offsetLocal = buffer.readUInt32LE(cursor + 42)
    const nome = buffer.toString('utf8', cursor + 46, cursor + 46 + tamanhoNome)

    // O cabecalho local tem tamanhos proprios de nome e extra.
    const nomeLocal = buffer.readUInt16LE(offsetLocal + 26)
    const extraLocal = buffer.readUInt16LE(offsetLocal + 28)
    const inicioDados = offsetLocal + 30 + nomeLocal + extraLocal
    const dados = buffer.subarray(inicioDados, inicioDados + tamanhoComprimido)

    try {
      entradas.set(nome, metodo === 0 ? Buffer.from(dados) : zlib.inflateRawSync(dados))
    } catch {
      throw new Error('Não foi possível ler a planilha. O arquivo pode estar corrompido ou protegido por senha.')
    }

    cursor += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario
  }

  return entradas
}

/** Textos compartilhados: cada <si> pode ter varios <t> (texto com formatacao mista). */
function lerTextosCompartilhados(xml: string): string[] {
  const textos: string[] = []
  for (const si of xml.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
    const pedacos = [...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => desescaparXml(m[1]))
    textos.push(pedacos.join(''))
  }
  return textos
}

type Celula = { coluna: number; valor: string }

function lerLinha(xmlLinha: string, compartilhados: string[]): Celula[] {
  const celulas: Celula[] = []
  for (const celula of xmlLinha.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? []) {
    const atributo = celula.match(/\br="([A-Z]+)\d+"/)
    if (!atributo) continue
    const coluna = colunaParaIndice(atributo[1])
    const tipo = (celula.match(/\bt="([^"]+)"/) ?? [])[1] ?? 'n'

    let valor = ''
    if (tipo === 's') {
      const bruto = (celula.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1] ?? ''
      valor = compartilhados[Number(bruto)] ?? ''
    } else if (tipo === 'inlineStr') {
      valor = [...celula.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => desescaparXml(m[1])).join('')
    } else {
      const bruto = (celula.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1]
      valor = bruto === undefined ? '' : desescaparXml(bruto.trim())
    }

    celulas.push({ coluna, valor })
  }
  return celulas
}

export function lerXlsx(bytes: Uint8Array): Tabela {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('Este arquivo não é uma planilha .xlsx. Se o Nex exportou .xls, exporte de novo como .xlsx.')
  }

  const entradas = lerZip(bytes)
  const planilha = entradas.get('xl/worksheets/sheet1.xml')
  if (!planilha) {
    throw new Error('Não foi possível ler a planilha. O arquivo pode estar corrompido ou protegido por senha.')
  }

  const xml = planilha.toString('utf8')
  const compartilhados = entradas.has('xl/sharedStrings.xml')
    ? lerTextosCompartilhados(entradas.get('xl/sharedStrings.xml')!.toString('utf8'))
    : []

  const linhasBrutas = xml.match(/<row\b[^>]*>[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? []
  const linhas: Celula[][] = linhasBrutas.map((l) => lerLinha(l, compartilhados))

  // Primeira linha com pelo menos duas celulas nao vazias e o cabecalho: titulo
  // e data no topo da planilha nao podem virar nome de coluna.
  const indiceCabecalho = linhas.findIndex(
    (l) => l.filter((c) => c.valor.trim() !== '').length >= 2,
  )
  if (indiceCabecalho < 0) {
    throw new Error('Não foi possível ler a planilha. O arquivo pode estar corrompido ou protegido por senha.')
  }

  const todas = linhas.slice(indiceCabecalho).filter((l) => l.length > 0)
  const largura = Math.max(...todas.map((l) => Math.max(...l.map((c) => c.coluna)) + 1))
  // Se a tabela comecar depois da coluna A, a primeira coluna usada vira a zero.
  const primeira = Math.min(...todas.map((l) => Math.min(...l.map((c) => c.coluna))))

  const matriz = todas.map((l) => {
    const campos: string[] = new Array(largura - primeira).fill('')
    for (const c of l) {
      if (c.coluna >= primeira) campos[c.coluna - primeira] = c.valor
    }
    return campos
  })

  const colunas = matriz[0]
  // Ultima linha so de vazios (rodape em branco) nao e dado.
  const corpo = matriz.slice(1).filter((l) => l.some((v) => v.trim() !== ''))

  return { colunas, linhas: corpo }
}
