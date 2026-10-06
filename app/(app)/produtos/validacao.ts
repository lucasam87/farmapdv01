// Validacao e traducao dos formularios de produto e estoque.
//
// Fica separado das Server Actions de proposito: sem `next/headers` nem
// `server-only` no caminho, da para testar de verdade — e o formulario nunca
// entrega texto cru para o banco (o texto do balcao vira erro em portugues aqui,
// e nao "invalid input syntax for type integer" no meio da tela).

import { parsearCentavos, parsearQuantidade } from '@/lib/dinheiro'

export type DadosProduto = {
  p_produto_id: string | null
  p_codigo_barras: string | null
  p_nome: string
  p_categoria: string | null
  p_unidade: string
  p_preco_custo: number
  p_preco_venda: number
  p_estoque_minimo: number
  p_ativo: boolean
}

export type DadosEntrada = {
  p_produto_id: string
  p_quantidade: number
  p_custo: number | null
  p_motivo: string
}

export type DadosAjuste = {
  p_produto_id: string
  p_novo_saldo: number
  p_motivo: string
}

export type Analise<T> = { ok: true; dados: T } | { ok: false; mensagem: string }

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo)
  return typeof valor === 'string' ? valor.trim() : ''
}

function nuloSeVazio(valor: string): string | null {
  return valor === '' ? null : valor
}

/** Estoque e quantidade de inventario: inteiro, e ZERO e legitimo. */
function lerInteiroNaoNegativo(valor: string): number | null {
  if (!/^\d+$/.test(valor)) return null
  const n = Number(valor)
  return Number.isSafeInteger(n) ? n : null
}

export function analisarProduto(formData: FormData): Analise<DadosProduto> {
  const id = texto(formData, 'produto_id')
  const nome = texto(formData, 'nome')
  if (nome === '') return { ok: false, mensagem: 'Informe o nome do produto.' }

  const custo = parsearCentavos(texto(formData, 'preco_custo'))
  if (custo === null) return { ok: false, mensagem: 'Preço de custo inválido. Use por exemplo 2,50.' }

  const venda = parsearCentavos(texto(formData, 'preco_venda'))
  if (venda === null) return { ok: false, mensagem: 'Preço de venda inválido. Use por exemplo 4,50.' }

  const minimoTexto = texto(formData, 'estoque_minimo')
  const minimo = minimoTexto === '' ? 0 : lerInteiroNaoNegativo(minimoTexto)
  if (minimo === null) {
    return { ok: false, mensagem: 'Estoque mínimo inválido. Use um número inteiro a partir de 0.' }
  }

  const unidade = texto(formData, 'unidade')

  return {
    ok: true,
    dados: {
      p_produto_id: id === '' ? null : id,
      p_codigo_barras: nuloSeVazio(texto(formData, 'codigo_barras')),
      p_nome: nome,
      p_categoria: nuloSeVazio(texto(formData, 'categoria')),
      p_unidade: unidade === '' ? 'un' : unidade,
      p_preco_custo: custo,
      p_preco_venda: venda,
      p_estoque_minimo: minimo,
      p_ativo: formData.get('ativo') !== null,
    },
  }
}

export function analisarEntrada(formData: FormData): Analise<DadosEntrada> {
  const id = texto(formData, 'produto_id')
  if (id === '') return { ok: false, mensagem: 'Produto não encontrado.' }

  const quantidade = parsearQuantidade(texto(formData, 'quantidade'))
  if (quantidade === null) {
    return { ok: false, mensagem: 'Quantidade inválida. Use um número inteiro de 1 a 9999.' }
  }

  // Custo vazio e diferente de custo zero: vazio significa "nao sei o custo, nao
  // mexe no que ja esta cadastrado" (caso 15 da Task 2).
  const custoTexto = texto(formData, 'custo')
  let custo: number | null = null
  if (custoTexto !== '') {
    custo = parsearCentavos(custoTexto)
    if (custo === null) return { ok: false, mensagem: 'Custo inválido. Use por exemplo 2,50.' }
  }

  const motivo = texto(formData, 'motivo')
  if (motivo === '') return { ok: false, mensagem: 'Informe o motivo da entrada.' }

  return { ok: true, dados: { p_produto_id: id, p_quantidade: quantidade, p_custo: custo, p_motivo: motivo } }
}

export function analisarAjuste(formData: FormData): Analise<DadosAjuste> {
  const id = texto(formData, 'produto_id')
  if (id === '') return { ok: false, mensagem: 'Produto não encontrado.' }

  const novoSaldo = lerInteiroNaoNegativo(texto(formData, 'novo_saldo'))
  if (novoSaldo === null) {
    return { ok: false, mensagem: 'Saldo inválido. Use um número inteiro a partir de 0.' }
  }

  const motivo = texto(formData, 'motivo')
  if (motivo === '') return { ok: false, mensagem: 'Informe o motivo do ajuste.' }

  return { ok: true, dados: { p_produto_id: id, p_novo_saldo: novoSaldo, p_motivo: motivo } }
}
