'use server'

import { revalidatePath } from 'next/cache'
import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'
import { validarMotivo } from './cancelamento'

// A action do cancelamento. Espelha `app/(app)/caixa/actions.ts`: valida o que dá
// para validar ANTES de chamar a RPC, e devolve o erro do banco CRU — a RPC
// `cancelar_venda` já fala português ("Só o dono pode cancelar vendas.", "Venda do
// dia 05/10 com caixa já fechado...") porque a matriz da spec §8.2 é dela.
//
// A checagem de papel NÃO é repetida aqui de propósito: quem decide se pode
// cancelar é a função no banco (`security definer`), e ela recusa de qualquer
// forma. Duplicar a regra na action seria uma segunda fonte de verdade.

export type Resultado = { ok: true; mensagem: string } | { ok: false; mensagem: string }

const SEM_PERFIL = 'Usuário sem perfil cadastrado. Fale com o responsável.'

export async function cancelarVenda(
  _anterior: Resultado | null,
  formData: FormData,
): Promise<Resultado> {
  const perfil = await perfilAtual()
  if (!perfil) return { ok: false, mensagem: SEM_PERFIL }

  const validado = validarMotivo(String(formData.get('motivo') ?? ''))
  if (!validado.ok) return validado

  // O id vem de um campo escondido: se alguém trocar o valor na mão, a RPC
  // recusa a venda que não existe e a mensagem crua aparece na tela.
  const venda_id = String(formData.get('venda_id') ?? '')

  const supabase = await criarClienteServidor()
  const { error } = await supabase.rpc('cancelar_venda', {
    p_venda_id: venda_id,
    p_motivo: validado.motivo,
  })
  if (error) return { ok: false, mensagem: error.message }

  // A lista e este detalhe mostram o resultado na hora: sem revalidar, a linha
  // continuaria com a cara de venda concluída até um recarregamento manual.
  revalidatePath('/vendas')
  revalidatePath(`/vendas/${venda_id}`)

  return { ok: true, mensagem: 'Venda cancelada. O estoque voltou.' }
}
