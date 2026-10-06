'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'
import { analisarProduto, analisarEntrada, analisarAjuste } from './validacao'

// A validacao do texto do balcao mora em validacao.ts (testada la); aqui fica
// so a parte que precisa de servidor: sessao, RPC e revalidacao.

export type ResultadoAcao = { ok: true } | { ok: false; mensagem: string }

const SEM_PERFIL = 'Usuário sem perfil cadastrado. Fale com o responsável.'

export async function salvarProduto(
  _estadoAnterior: ResultadoAcao | null,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await perfilAtual()
  if (!perfil) return { ok: false, mensagem: SEM_PERFIL }

  const analise = analisarProduto(formData)
  if (!analise.ok) return { ok: false, mensagem: analise.mensagem }

  const supabase = await criarClienteServidor()
  const { data, error } = await supabase.rpc('produto_salvar', analise.dados)
  if (error) return { ok: false, mensagem: error.message }

  revalidatePath('/produtos')
  // redirect() lanca: nao pode haver codigo depois dele.
  redirect(`/produtos/${data as string}`)
}

export async function registrarEntrada(
  _estadoAnterior: ResultadoAcao | null,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await perfilAtual()
  if (!perfil) return { ok: false, mensagem: SEM_PERFIL }

  const analise = analisarEntrada(formData)
  if (!analise.ok) return { ok: false, mensagem: analise.mensagem }

  const supabase = await criarClienteServidor()
  const { error } = await supabase.rpc('produto_entrada', analise.dados)
  if (error) return { ok: false, mensagem: error.message }

  revalidatePath(`/produtos/${analise.dados.p_produto_id}`)
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  return { ok: true }
}

export async function registrarAjuste(
  _estadoAnterior: ResultadoAcao | null,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await perfilAtual()
  if (!perfil) return { ok: false, mensagem: SEM_PERFIL }

  const analise = analisarAjuste(formData)
  if (!analise.ok) return { ok: false, mensagem: analise.mensagem }

  const supabase = await criarClienteServidor()
  const { error } = await supabase.rpc('produto_ajuste', analise.dados)
  if (error) return { ok: false, mensagem: error.message }

  revalidatePath(`/produtos/${analise.dados.p_produto_id}`)
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  return { ok: true }
}
