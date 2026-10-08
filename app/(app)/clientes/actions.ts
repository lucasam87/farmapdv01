'use server'

import { revalidatePath } from 'next/cache'
import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'
import { validarCliente } from './validacao'

// Cadastro e edicao de cliente. A validacao do texto digitado mora em
// validacao.ts (pura, testada); aqui fica o que precisa de servidor: sessao,
// montagem do payload, RPC e revalidacao.
//
// O QUE SOBE PARA A RPC E DECIDIDO AQUI, NAO NO FORMULARIO
// --------------------------------------------------------
// `cliente_salvar` (015) compara o que RECEBE com o que esta GRAVADO: para o
// atendente, reenviar o mesmo limite/bloqueio e reeditar o nome, mas mudar
// qualquer um dos dois e recusado. Por isso o atendente manda `null` nos tres
// campos de dono (limite, bloqueio e saldo inicial): `null` significa "nao mexe"
// (015:116-118), e `0`/`false` significariam "zera"/"desbloqueia" — o que
// recusaria a edicao de telefone de um cliente com limite liberado. A tela nem
// oferece esses campos a ele (formulario.tsx), mas a guarda de verdade e aqui:
// campo escondido no navegador o operador consegue inventar.

export type Resultado = { ok: true; mensagem: string } | { ok: false; mensagem: string }

const SEM_PERFIL = 'Usuário sem perfil cadastrado. Fale com o responsável.'

export async function salvarCliente(
  _anterior: Resultado | null,
  formData: FormData,
): Promise<Resultado> {
  const perfil = await perfilAtual()
  if (!perfil) return { ok: false, mensagem: SEM_PERFIL }

  const ehDono = perfil.papel === 'dono'

  const analise = validarCliente(
    {
      nome: String(formData.get('nome') ?? ''),
      telefone: String(formData.get('telefone') ?? ''),
      cpf: String(formData.get('cpf') ?? ''),
      limite: String(formData.get('limite_credito') ?? ''),
      saldoInicial: String(formData.get('saldo_inicial') ?? ''),
    },
    ehDono,
  )
  if (!analise.ok) return { ok: false, mensagem: analise.mensagem }

  const { valores } = analise
  const id = String(formData.get('cliente_id') ?? '').trim()

  const supabase = await criarClienteServidor()
  const { data, error } = await supabase.rpc('cliente_salvar', {
    p_id: id === '' ? null : id,
    p_nome: valores.nome,
    p_telefone: valores.telefone,
    p_cpf: valores.cpf,
    // Dono: o limite da tela (campo vazio = 0 = "nao faz crediario").
    // Atendente: `null` = "nao mexe" (ver o cabecalho).
    p_limite_credito: ehDono ? valores.limite : null,
    // O checkbox nao marcado nao manda nada: o `false` explicito e do dono, o
    // unico que pode desbloquear. `null` para o atendente nao vira `false` no
    // banco (015:117).
    p_bloqueado: ehDono ? formData.get('bloqueado') === 'sim' : null,
    p_observacao: String(formData.get('observacao') ?? ''),
    // O saldo inicial e um LANCAMENTO, e so um por cliente (015:157-165). O campo
    // da tela nunca vem preenchido com o saldo ja lancado, e o que nao foi
    // digitado agora vira `null` (nunca `0` positivo reenviado): sem isso, o dono
    // que so corrigisse o telefone levaria 'Este cliente já tem um saldo inicial
    // lançado.' e nem o telefone salvava — a guarda roda ANTES do update.
    p_saldo_inicial: ehDono && valores.saldoInicial > 0 ? valores.saldoInicial : null,
  })
  // O erro do banco ja e portugues e nomeia o fato (CPF repetido, saldo repetido,
  // limite do dono). Envelopar ou traduzir aqui so criaria duas versoes do mesmo
  // recado.
  if (error) return { ok: false, mensagem: error.message }

  const clienteId = (data as string | null) ?? id
  revalidatePath('/clientes')
  if (clienteId !== '') revalidatePath(`/clientes/${clienteId}`)
  return { ok: true, mensagem: 'Cliente salvo.' }
}
