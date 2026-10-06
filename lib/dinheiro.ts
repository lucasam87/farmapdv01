// Leitura de dinheiro e quantidade DIGITADOS (ou vindos de planilha).
//
// Direcao oposta ao lib/format.ts: la e centavos -> texto de exibicao; aqui e
// texto do usuario -> centavos. O contrato do projeto e que dinheiro circula em
// CENTAVOS INTEIROS, entao nada aqui devolve fracao nem usa float para somar.
//
// A armadilha que este modulo existe para evitar:
//   parseFloat('4,50')  -> 4      (perde os centavos)
//   parseFloat('1.234') -> 1.234  (le milhar como decimal)
// Nenhum dos dois pode acontecer: o primeiro cobra a mais, o segundo cobra a menos.

/** Remove tudo que nao seja digito ou separador, e rejeita o que sobrar de estranho. */
function limpar(texto: string): string | null {
  // R$ , espacos (inclusive o nao-quebravel U+00A0 do Intl) e o menos sao
  // removidos; qualquer outra letra ou simbolo invalida a leitura.
  const semSimbolos = texto.replace(/R\$/gi, '').replace(/[\s\u00A0]/g, '')
  if (semSimbolos === '') return null
  if (!/^[\d.,]+$/.test(semSimbolos)) return null
  return semSimbolos
}

export function parsearCentavos(texto: string): number | null {
  if (texto === null || texto === undefined) return null
  if (typeof texto !== 'string') return null

  const limpo = limpar(texto)
  if (limpo === null) return null

  // Qual separador e o decimal? O ULTIMO, e so se tiver 1 ou 2 digitos ate o
  // fim. Assim "4,50" tem decimal, "1.234" nao tem (tres digitos = milhar) e
  // "4,5,0" seria recusado de qualquer forma.
  const achado = limpo.match(/[.,](\d{1,2})$/)
  let inteiro: string
  let decimais: string

  if (achado) {
    const corte = limpo.length - achado[0].length
    inteiro = limpo.slice(0, corte)
    decimais = achado[1]
    // Mais de um separador na parte inteira com o mesmo caractere do decimal
    // significa ambiguidade real ("4,5,0"): recusa.
    if (inteiro.includes(achado[0][0])) return null
  } else {
    inteiro = limpo
    decimais = ''
  }

  // Os separadores que sobraram na parte inteira sao de milhar.
  inteiro = inteiro.replace(/[.,]/g, '')
  if (inteiro === '' && decimais === '') return null
  if (!/^\d*$/.test(inteiro) || !/^\d*$/.test(decimais)) return null

  const reais = inteiro === '' ? 0 : Number(inteiro)
  const centavos = decimais === '' ? 0 : Number(decimais.padEnd(2, '0'))

  // Number() de uma string so de digitos e exato ate 2^53; a soma aqui e de
  // inteiros, entao nao ha erro de ponto flutuante.
  return reais * 100 + centavos
}

export function parsearQuantidade(texto: string): number | null {
  if (texto === null || texto === undefined) return null
  if (typeof texto !== 'string') return null

  const limpo = texto.replace(/[\s\u00A0]/g, '')
  // Exigir so digitos ANTES de converter e o que faz "1.5" virar null em vez de
  // 1 — o mesmo cuidado do bug A11 da spec, do lado do banco.
  if (!/^\d+$/.test(limpo)) return null

  const n = Number(limpo)
  if (!Number.isSafeInteger(n)) return null
  if (n < 1 || n > 9999) return null

  return n
}
