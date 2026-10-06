// Leitura de CSV do jeito que o export brasileiro chega.
//
// O erro que este modulo existe para evitar e `split(';')`: um nome como
// "DIPIRONA; 500mg" viraria duas colunas e a planilha inteira sairia desalinhada
// — com o preco no lugar do codigo de barras. Por isso o leitor percorre o texto
// caractere a caractere, com estado de "dentro de aspas".
//
// Nao ha dependencia externa: e um formato simples e o projeto evita pacote novo
// no caminho onde erro custa caro.

export type Tabela = {
  colunas: string[]
  linhas: string[][]
}

/** Separador que aparece mais vezes na primeira linha, ignorando o que esta entre aspas. */
function detectarSeparador(primeira: string): string {
  let pontoVirgula = 0
  let virgula = 0
  let dentroDeAspas = false

  for (let i = 0; i < primeira.length; i++) {
    const c = primeira[i]
    if (c === '"') {
      dentroDeAspas = !dentroDeAspas
    } else if (!dentroDeAspas) {
      if (c === ';') pontoVirgula++
      else if (c === ',') virgula++
    }
  }

  // Empate resolve para ';': e o separador do export brasileiro.
  if (pontoVirgula === 0 && virgula === 0) return ''
  return virgula > pontoVirgula ? ',' : ';'
}

/** Quebra uma linha em campos, respeitando aspas e tratando "" como aspas literal. */
function lerLinha(linha: string, separador: string): string[] {
  const campos: string[] = []
  let atual = ''
  let dentroDeAspas = false

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i]

    if (dentroDeAspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') {
          // "" dentro de aspas e uma aspa literal.
          atual += '"'
          i++
        } else {
          dentroDeAspas = false
        }
      } else {
        atual += c
      }
    } else if (c === '"') {
      dentroDeAspas = true
    } else if (separador !== '' && c === separador) {
      campos.push(atual)
      atual = ''
    } else {
      atual += c
    }
  }

  campos.push(atual)
  return campos
}

export function lerCsv(texto: string): Tabela {
  if (typeof texto !== 'string' || texto.replace(/[\s\u00A0]/g, '') === '') {
    return { colunas: [], linhas: [] }
  }

  // BOM (U+FEFF) na frente do primeiro cabecalho estragaria o nome da coluna.
  const semBom = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto

  const fisicas = semBom.split(/\r\n|\n|\r/)
  const linhasFisicas = fisicas.filter((l) => l.trim() !== '')
  if (linhasFisicas.length === 0) return { colunas: [], linhas: [] }

  const separador = detectarSeparador(linhasFisicas[0])
  const colunas = lerLinha(linhasFisicas[0], separador)

  const linhas = linhasFisicas.slice(1).map((l) => {
    const campos = lerLinha(l, separador)
    // Linha torta (menos campos) nao pode desalinhar: completa com vazio.
    while (campos.length < colunas.length) campos.push('')
    return campos
  })

  return { colunas, linhas }
}

/**
 * O arquivo veio em Latin-1 (padrao antigo do Windows)?
 *
 * O decodificador de UTF-8 sem `fatal` troca byte invalido por U+FFFD e NUNCA
 * lanca — seria impossivel distinguir. Com `fatal` ele lanca, e e isso que
 * separa "UTF-8 valido" de "veio em Latin-1".
 */
export function pareceLatin1(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return false
  } catch {
    return true
  }
}
