'use server'

import { revalidatePath } from 'next/cache'
import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'
import { formatarMoeda } from '@/lib/format'
import { validarValorInicial, validarMovimento, validarFechamento } from './validacao'

// As tres acoes da tela de caixa. Cada uma valida ANTES de chamar a RPC: o banco
// tambem recusa (030_caixa.sql cobre as 30 assercoes dele), mas o erro que ele
// devolve e tecnico e o operador do balcao nao tem o que fazer com ele.

export type Resultado = { ok: true; mensagem: string } | { ok: false; mensagem: string }

const SEM_PERFIL = 'Usuário sem perfil cadastrado. Fale com o responsável.'
const SO_O_DONO = 'Só o dono pode fechar o caixa.'

/** Le o esperado da view `v_caixa_atual` — nunca de um campo do formulario. */
async function esperadoDaSessaoAberta(): Promise<number | null> {
  const supabase = await criarClienteServidor()
  // A sessao MAIS RECENTE, igual a tela e igual as RPCs: a view tem uma linha por
  // terminal aberto, entao `maybeSingle()` sozinho falharia com dois terminais.
  const { data } = await supabase
    .from('v_caixa_atual')
    .select('esperado_dinheiro')
    .order('aberto_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? (data.esperado_dinheiro as number) : null
}

export async function abrirCaixa(_anterior: Resultado | null, formData: FormData): Promise<Resultado> {
  const perfil = await perfilAtual()
  if (!perfil) return { ok: false, mensagem: SEM_PERFIL }

  const validado = validarValorInicial(String(formData.get('valor_inicial') ?? ''))
  if (!validado.ok) return validado

  const supabase = await criarClienteServidor()
  const { error } = await supabase.rpc('abrir_caixa', { p_valor_inicial: validado.valor })
  if (error) return { ok: false, mensagem: error.message }

  revalidatePath('/caixa')
  return { ok: true, mensagem: 'Caixa aberto.' }
}

export async function movimentarCaixa(
  _anterior: Resultado | null,
  formData: FormData,
): Promise<Resultado> {
  const perfil = await perfilAtual()
  if (!perfil) return { ok: false, mensagem: SEM_PERFIL }

  const validado = validarMovimento(
    String(formData.get('tipo') ?? ''),
    String(formData.get('valor') ?? ''),
    String(formData.get('motivo') ?? ''),
  )
  if (!validado.ok) return validado

  const supabase = await criarClienteServidor()
  const { error } = await supabase.rpc('caixa_movimento', {
    p_tipo: validado.valor.tipo,
    p_valor: validado.valor.centavos,
    p_motivo: validado.valor.motivo,
  })
  if (error) return { ok: false, mensagem: error.message }

  revalidatePath('/caixa')
  return {
    ok: true,
    mensagem: validado.valor.tipo === 'sangria' ? 'Sangria lançada.' : 'Suprimento lançado.',
  }
}

export async function fecharCaixa(_anterior: Resultado | null, formData: FormData): Promise<Resultado> {
  const perfil = await perfilAtual()
  if (!perfil) return { ok: false, mensagem: SEM_PERFIL }
  if (perfil.papel !== 'dono') return { ok: false, mensagem: SO_O_DONO }

  // O esperado vem da VIEW, e nao de um campo escondido do formulario: um campo
  // escondido o operador consegue mexer pelo navegador, e ai a diferenca do
  // fechamento viraria o que ele quisesse.
  const esperado = await esperadoDaSessaoAberta()
  if (esperado === null) return { ok: false, mensagem: 'Não há caixa aberto.' }

  const validado = validarFechamento(
    String(formData.get('valor_contado') ?? ''),
    String(formData.get('observacao') ?? ''),
    esperado,
  )
  if (!validado.ok) return validado

  const supabase = await criarClienteServidor()
  const { data, error } = await supabase.rpc('fechar_caixa', {
    p_valor_contado: validado.valor.contado,
    p_observacao: validado.valor.observacao,
  })
  if (error) return { ok: false, mensagem: error.message }

  revalidatePath('/caixa')
  // A RPC devolve {esperado_dinheiro, diferenca} — mostrar fecha o ciclo: o dono
  // ve a conta que o sistema fez, e nao so "fechado".
  const resultado = data as { esperado_dinheiro?: number; diferenca?: number } | null
  const diferenca = resultado?.diferenca ?? 0
  return {
    ok: true,
    mensagem:
      diferenca === 0
        ? 'Caixa fechado. A gaveta bateu com o esperado.'
        : `Caixa fechado com diferença de ${formatarMoeda(Math.abs(diferenca))} (${diferenca > 0 ? 'a mais' : 'a menos'}).`,
  }
}
