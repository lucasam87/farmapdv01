// Traducao de LinhaProduto (o que a planilha virou) para o JSON que a RPC
// importar_produtos entende.
//
// Fica FORA do arquivo 'use server' de proposito: num arquivo de Server Actions
// todo export precisa ser async (o Next 16 recusa o resto), e esta funcao e pura
// — assim ela pode ser testada diretamente, que e o que prova a regra mais
// perigosa da importacao.

import type { ColunasPresentes, LinhaProduto } from '@/lib/tabela'

export function paraOLinhasJson(linhas: LinhaProduto[], presentes: ColunasPresentes) {
  return linhas
    .filter((l) => l.erros.length === 0)
    .map((l) => {
      const base: Record<string, unknown> = {
        codigo_barras: l.codigo_barras,
        nome: l.nome,
        categoria: l.categoria,
        unidade: l.unidade,
      }
      // A chave AUSENTE e diferente de valor nulo, e isso vale para o preco
      // tambem: e o que faz a RPC nao mexer no que ja esta cadastrado. So inclui
      // os campos cuja coluna veio na planilha — sem isto, reimportar uma
      // planilha sem coluna de preco ZERAVA o preco de venda do catalogo.
      //
      // `preco_custo` e por LINHA, e nao pela coluna: o exportador do sistema
      // antigo escreve a palavra "null" nas linhas sem custo (524 produtos do
      // catalogo real), e nessas o custo cadastrado nao pode ser tocado.
      if (l.preco_custo !== null) base.preco_custo = l.preco_custo
      if (presentes.preco_venda) base.preco_venda = l.preco_venda
      if (presentes.estoque_minimo) base.estoque_minimo = l.estoque_minimo
      // O estoque ja usava o mesmo desenho: `estoque_atual` e null quando a
      // coluna nao veio.
      if (l.estoque_atual !== null) base.estoque_inicial = l.estoque_atual
      return base
    })
}
