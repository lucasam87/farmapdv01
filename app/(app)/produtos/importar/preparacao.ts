// Traducao de LinhaProduto (o que a planilha virou) para o JSON que a RPC
// importar_produtos entende.
//
// Fica FORA do arquivo 'use server' de proposito: num arquivo de Server Actions
// todo export precisa ser async (o Next 16 recusa o resto), e esta funcao e pura
// — assim ela pode ser testada diretamente, que e o que prova a regra mais
// perigosa da importacao.

import type { LinhaProduto } from '@/lib/tabela'

export function paraOLinhasJson(linhas: LinhaProduto[]) {
  return linhas
    .filter((l) => l.erros.length === 0)
    .map((l) => {
      const base: Record<string, unknown> = {
        codigo_barras: l.codigo_barras,
        nome: l.nome,
        categoria: l.categoria,
        unidade: l.unidade,
        preco_custo: l.preco_custo,
        preco_venda: l.preco_venda,
        estoque_minimo: l.estoque_minimo,
      }
      // A chave AUSENTE e diferente de valor nulo: e isso que faz a RPC nao
      // mexer no estoque de quem ja existe. So inclui quando veio da planilha.
      if (l.estoque_atual !== null) base.estoque_inicial = l.estoque_atual
      return base
    })
}
