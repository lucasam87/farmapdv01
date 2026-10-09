import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ResultadoReserva } from '@/app/api/agente/orquestracao'

// O cliente `service_role` do Supabase — e a UNICA coisa do sistema autorizada a
// usar `SUPABASE_SERVICE_ROLE_KEY`. Ele existe para as TRES RPCs do orcamento
// (migration 017) e para mais nada.
//
// A FRONTEIRA, escrita em codigo: aqui nao ha `from(...)`. Nenhuma tabela ou view
// de negocio passa por este cliente — as leituras de vendas e estoque usam
// `criarClienteServidor()` (a sessao do usuario, sob RLS). As tabelas do ledger
// nao tem policy nenhuma: `service_role` e a unica role que as alcanca, e so
// pelas funcoes.
//
// `server-only` na primeira linha e o que impede o bundle do navegador de
// importar este modulo: o Next implementa esse import no compilador, entao o
// build quebra em vez de vazar a chave.
//
// A CHAVE NORMALMENTE NAO ESTA CONFIGURADA (o ambiente local nao tem hoje). O que
// acontece nesse caso e: o cliente nao e criado, a funcao devolve uma falha
// generica e a rota responde 502 com uma mensagem curta em portugues. Nada aqui
// registra a chave, o valor dela, nem sequer o NOME dela em mensagem de erro, e
// nada pede ao usuario que a configure.

/** A RPC `public.agente_orcamento_reservar` recusa o teto com esta mensagem. */
const MENSAGEM_ORCAMENTO_ESGOTADO = /esgotado/i

function cliente(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (url === undefined || url === '' || chave === undefined || chave === '') return null

  return createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/**
 * Reserva os micros da chamada no mes informado, ANTES de chamar o provedor.
 *
 * `mes` tem que ser o primeiro dia do mes de Sao Paulo (`mesSaoPaulo`): a propria
 * RPC recusa qualquer outro dia. Orcamento esgotado vira um motivo proprio, para
 * a rota responder 429; qualquer outra falha (inclusive a chave ausente) e
 * `falha`, que vira 502 — o usuario nao precisa saber, e nao vai saber, o que
 * quebrou por dentro.
 */
export async function reservar(mes: string, micros: number): Promise<ResultadoReserva> {
  const supabase = cliente()
  if (supabase === null) return { ok: false, motivo: 'falha' }

  const { data, error } = await supabase.rpc('agente_orcamento_reservar', {
    p_mes: mes,
    p_micros: micros,
  })

  if (error !== null) {
    return { ok: false, motivo: MENSAGEM_ORCAMENTO_ESGOTADO.test(error.message) ? 'esgotado' : 'falha' }
  }

  // A funcao devolve o uuid da reserva; qualquer coisa que nao seja um id
  // utilizavel e falha, porque sem id nao ha como reconciliar nem liberar.
  if (typeof data !== 'string' || data === '') return { ok: false, motivo: 'falha' }

  return { ok: true, id: data }
}

/**
 * Fecha a reserva com o custo real em micros (o `usage` do provedor ja passou
 * pela fronteira de inteiro nao-negativo em `orquestracao.ts`).
 *
 * Melhor esforco: se a RPC falhar, a reserva maxima continua consumida ate o fim
 * do mes. E o lado conservador — nunca devolve saldo que possa ter sido
 * faturado. Nao lanca e nao registra nada.
 */
export async function reconciliar(id: string, micros: number): Promise<void> {
  const supabase = cliente()
  if (supabase === null) return

  await supabase.rpc('agente_orcamento_reconciliar', {
    p_reserva_id: id,
    p_custo_micros: micros,
  })
}

/**
 * Libera a reserva de uma falha COMPROVADAMENTE anterior ao envio (chave
 * ausente, URL invalida). A RPC recusa liberar reserva ja liquidada ou ja
 * liberada, e esse erro e engolido de proposito — a reserva fica, que e o lado
 * conservador. Nao lanca e nao registra nada.
 */
export async function liberar(id: string): Promise<void> {
  const supabase = cliente()
  if (supabase === null) return

  await supabase.rpc('agente_orcamento_liberar', { p_reserva_id: id })
}
