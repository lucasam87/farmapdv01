// Escape para os filtros de TEXTO do PostgREST.
//
// Por que isto existe: o `.or()` do supabase-js monta a string do filtro CRUA —
// o proprio TSDoc dele avisa que quem chama precisa sanitizar. Um termo digitado
// no balcao com virgula ou parentese, portanto, nao e um caso exotico: ele QUEBRA
// a consulta (a virgula e o separador de condicoes do `or`) ou muda o filtro. Nome
// de medicamento com virgula ("DIPIRONA, 20 COMPRIMIDOS") e comum, e o sintoma que
// o atendente ve e "a busca nao acha o produto".
//
// A saida e entregar o valor entre ASPAS DUPLAS, que e a forma que o PostgREST
// tem de tratar o conteudo como literal. Dentro das aspas, os unicos caracteres
// ainda especiais sao a propria aspa e a barra invertida, e os dois sao escapados.

/** Devolve o valor entre aspas, seguro para usar como operando de um filtro. */
export function valorDeFiltro(texto: string): string {
  return `"${texto.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Como usar: `or(\`codigo_barras.eq.${valorDeFiltro(t)},nome.ilike.${valorDeFiltro(`%${t}%`)}\`)` */
export function filtroDeBuscaDeProduto(termo: string): string {
  return `codigo_barras.eq.${valorDeFiltro(termo)},nome.ilike.${valorDeFiltro(`%${termo}%`)}`
}
