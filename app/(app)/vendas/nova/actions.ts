'use server'

import { revalidatePath } from 'next/cache'
import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'
import type { FormaPagamento } from './pagamento'

// A unica escrita do PDV. O navegador manda INTENCAO (produto, quantidade, forma
// e valor); o banco decide preco, total, troco, limite e estoque (spec 4).

export type EntradaVenda = {
  chave: string
  cliente_id: string | null
  itens: { produto_id: string; quantidade: number }[]
  pagamentos: { forma: FormaPagamento; valor: number }[]
  desconto: number
}

export type VendaRegistrada = { id: string; numero: number; total: number; troco: number }

export type ResultadoVenda =
  | { ok: true; venda: VendaRegistrada }
  | { ok: false; mensagem: string }

export async function finalizarVenda(entrada: EntradaVenda): Promise<ResultadoVenda> {
  const perfil = await perfilAtual()
  if (!perfil) return { ok: false, mensagem: 'Usuário sem perfil cadastrado. Fale com o responsável.' }

  // Defesa em profundidade: o botao ja fica desabilitado sem carrinho, mas o
  // servidor nao confia na tela.
  if (!Array.isArray(entrada.itens) || entrada.itens.length === 0) {
    return { ok: false, mensagem: 'Carrinho vazio.' }
  }
  if (!Array.isArray(entrada.pagamentos) || entrada.pagamentos.length === 0) {
    return { ok: false, mensagem: 'Informe a forma de pagamento.' }
  }

  const supabase = await criarClienteServidor()
  const { data, error } = await supabase.rpc('registrar_venda', {
    p_chave_idempotencia: entrada.chave,
    p_cliente_id: entrada.cliente_id,
    p_itens: entrada.itens,
    p_pagamentos: entrada.pagamentos,
    p_desconto: entrada.desconto,
  })

  if (error) {
    // A mensagem ja vem em portugues e dizendo o que fazer (spec 9).
    return { ok: false, mensagem: error.message }
  }

  revalidatePath('/vendas')
  return { ok: true, venda: data as VendaRegistrada }
}
