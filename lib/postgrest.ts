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

/**
 * Busca de cliente no balcao: nome, telefone ou CPF. Como usar:
 * `or(filtroDeBuscaDeCliente(termo))`.
 *
 * As clausulas de telefone e CPF sao CONDICIONAIS, e nao uma lista fixa como no
 * produto: as duas colunas guardam DIGITO PURO (015:100-101), entao o termo
 * pontuado tem de virar digito antes de virar `ilike`. Sem a condicional, um
 * termo so com letras poria `telefone.ilike."%%"` na consulta — que casa
 * QUALQUER telefone gravado — e a busca por nome devolveria a lista inteira.
 *
 * O nome continua casando o termo CRU (com pontuacao e tudo): quem digita
 * "SILVA, MARIA" ou "(11) 91234" espera achar o nome exatamente como o digitou.
 */
export function filtroDeBuscaDeCliente(termo: string): string {
  const clausulas = [`nome.ilike.${valorDeFiltro(`%${termo}%`)}`]

  const digitos = termo.replace(/\D/g, '')
  if (digitos !== '') {
    clausulas.push(`telefone.ilike.${valorDeFiltro(`%${digitos}%`)}`)
    clausulas.push(`cpf.ilike.${valorDeFiltro(`%${digitos}%`)}`)
  }

  return clausulas.join(',')
}

/**
 * Busca na lista de DEVEDORES do crediario (`v_clientes_devedores`). Como usar:
 * `or(filtroDeBuscaDeDevedor(termo))`.
 *
 * Por que nao e a mesma funcao de cima, se o assunto e o mesmo: a view do
 * crediario NAO expoe `cpf` (005_views.sql:130-140 — `cliente_id, nome,
 * telefone, limite_credito, saldo`). Um termo com digito — a busca por telefone,
 * que e o caso comum no balcao — poria `cpf.ilike."%11%"` na consulta e o
 * PostgREST recusaria a consulta INTEIRA (coluna inexistente): a tela diria
 * "nenhum devedor" em vez de achar o cliente que o operador esta vendo na frente.
 * As clausulas sao as de `filtroDeBuscaDeCliente`, menos o CPF.
 *
 * O telefone continua CONDICIONAL pelo mesmo motivo de la: sem digito no termo,
 * `%%` casaria todo devedor gravado e a busca por nome devolveria a lista toda.
 */
export function filtroDeBuscaDeDevedor(termo: string): string {
  const clausulas = [`nome.ilike.${valorDeFiltro(`%${termo}%`)}`]

  const digitos = termo.replace(/\D/g, '')
  if (digitos !== '') {
    clausulas.push(`telefone.ilike.${valorDeFiltro(`%${digitos}%`)}`)
  }

  return clausulas.join(',')
}