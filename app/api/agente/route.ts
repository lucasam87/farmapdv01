import { NextResponse } from 'next/server'
import { LIMITE_RESULTADOS } from '@/app/(app)/agente/logica'
import { classificar, classificarAssunto, classificarFinanceiro } from '@/lib/agente/deepseek'
import { autenticacaoAtual, type Perfil } from '@/lib/auth/perfil'
import { liberar, reconciliar, reservar } from '@/lib/supabase/privilegiado'
import { criarClienteServidor } from '@/lib/supabase/server'
import type {
  ConsultaFinanceiroValidada,
  DadosFinanceiro,
  ResumoVendas,
  ResultadoLucro,
} from '@/app/(app)/agente/logica'
import {
  processarPergunta,
  type Deps,
  type FiltroConsulta,
  type IntencaoConsulta,
  type LinhaConsulta,
  type ResultadoConsulta,
} from './orquestracao'

// `POST /api/agente` — o adaptador fino da consulta gerencial do agente.
//
// Este arquivo NAO decide nada: ele le a sessao, le o corpo, monta as seis
// dependencias reais e entrega tudo para `processarPergunta` (orquestracao.ts),
// que tem a ordem do fluxo e os limites testados por injecao. Aqui ficam so as
// duas coisas que a orquestracao nao pode ter: o `NextResponse` e os clientes
// Supabase de verdade.
//
// O QUE ESTA ROTA NUNCA FAZ:
//   - chamar o provedor ou o ledger sem sessao e perfil ativo (a ordem esta na
//     orquestracao, e ha teste);
//   - ler dado de negocio pelo cliente privilegiado (o `service_role` entra
//     apenas nas RPCs do orcamento, via `lib/supabase/privilegiado.ts`);
//   - registrar pergunta, resposta, prompt, cookie, chave ou linha de banco.

/** Uma consulta por intencao; `limite` nulo significa "sem corte" (vendas por dia). */
async function consultar(
  intencao: IntencaoConsulta,
  filtro: FiltroConsulta,
  limite: number | null,
): Promise<ResultadoConsulta> {
  // Cliente da SESSAO do usuario: as views sao `security_invoker` e todo o RLS do
  // banco vale. O cliente privilegiado jamais aparece por aqui.
  const supabase = await criarClienteServidor()

  if (intencao === 'vendas_dia') {
    const de = filtro?.de
    const ate = filtro?.ate
    if (de === undefined || ate === undefined) return { ok: false }

    // SEM `.limit()`: o periodo validado e de no maximo 31 dias e a view devolve
    // uma linha por dia. Cortar em 10 faria o total do periodo virar um total
    // PARCIAL apresentado como total.
    const { data, error } = await supabase
      .from('v_vendas_dia')
      .select('dia, quantidade, total, ticket_medio')
      .gte('dia', de)
      .lte('dia', ate)
      .order('dia')

    if (error) return { ok: false }
    return { ok: true, linhas: data ?? [] }
  }

  if (intencao === 'margem_produto') {
    const de = filtro?.de
    const ate = filtro?.ate
    if (de === undefined || ate === undefined || limite === null) return { ok: false }

    // As duas funcoes sao `security definer` e checam o papel do dono por dentro.
    const [ranking, fora] = await Promise.all([
      supabase.rpc('margem_produtos', { p_de: de, p_ate: ate, p_limite: limite }),
      supabase.rpc('margem_sem_custo', { p_de: de, p_ate: ate }),
    ])
    if (ranking.error || fora.error) return { ok: false }

    // `margem_sem_custo` devolve uma linha com `sem_custo`; qualquer outra coisa e falha,
    // nunca "zero produtos fora" (seria dizer que o ranking esta completo).
    const contagem = Number((fora.data as { sem_custo: unknown }[] | null)?.[0]?.sem_custo)
    if (!Number.isFinite(contagem)) return { ok: false }

    return {
      ok: true,
      linhas: (ranking.data ?? []) as unknown as LinhaConsulta[],
      semCusto: contagem,
    }
  }

  // As tres views sem data NAO aceitam periodo (o modelo ja teria virado
  // `fora_escopo`) e a ordem e a que a propria view define.
  const alvo =
    intencao === 'mais_vendidos'
      ? { view: 'v_mais_vendidos', colunas: 'nome, quantidade' }
      : intencao === 'estoque_baixo'
        ? { view: 'v_estoque_baixo', colunas: 'nome, estoque_atual' }
        : { view: 'v_estoque_parado', colunas: 'nome, estoque_atual' }

  const { data, error } = await supabase
    .from(alvo.view)
    .select(alvo.colunas)
    .limit(limite ?? LIMITE_RESULTADOS)

  if (error) return { ok: false }
  // As views nao estao nos tipos gerados do banco (o projeto nao usa o generic
  // `Database`), entao o retorno aqui e `unknown` e a conversao e explicita.
  return { ok: true, linhas: (data ?? []) as unknown as LinhaConsulta[] }
}

/** `bigint` do PostgREST chega como numero em JSON; qualquer outra coisa e falha. */
function numero(valor: unknown): number | null {
  const n = typeof valor === 'number' ? valor : Number(valor)
  return Number.isFinite(n) ? n : null
}

/**
 * Anda `passo` dias no calendario, em UTC.
 *
 * UTC e nao o fuso do processo pelo mesmo motivo de `logica.ts`: o fuso da maquina
 * nao pode mudar o dia. Serve so para achar o periodo ANTERIOR da comparacao, que
 * parte de uma data ja validada e proxima.
 */
function somarDias(dia: string, passo: number): string {
  const [ano, mes, d] = dia.split('-').map(Number)
  const data = new Date(Date.UTC(ano, mes - 1, d))
  if (ano >= 0 && ano < 100) data.setUTCFullYear(ano)
  return new Date(data.getTime() + passo * 86_400_000).toISOString().slice(0, 10)
}

/** Datas do intervalo, INCLUSIVE nas duas pontas, por aritmetica — nunca dia a dia. */
function diasInclusivos(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000) + 1
}

/**
 * As consultas do ESPECIALISTA de Vendas e financeiro.
 *
 * A orquestracao entrega a consulta JA VALIDADA e recebe os dados JA no formato do
 * montador: e aqui — e so aqui — que se sabe que os numeros vem de
 * `relatorio_resumo`, `relatorio_formas_pagamento` ou `relatorio_lucro`.
 *
 * `null` em qualquer ponto significa falha de leitura, e a rota responde 500. Nunca
 * se devolve um resumo com campo torto: `numero()` derruba para `null` em vez de
 * deixar `NaN` chegar ao texto que o dono le.
 */
async function consultarFinanceiro(
  consulta: ConsultaFinanceiroValidada,
): Promise<DadosFinanceiro | null> {
  // Cliente da SESSAO: as funcoes de relatorio sao `security definer` e checam o
  // papel por dentro. O cliente privilegiado nao aparece aqui.
  const supabase = await criarClienteServidor()
  const { de, ate } = consulta
  const periodo = { de, ate }

  async function lerResumo(d: string, a: string): Promise<ResumoVendas | null> {
    const { data, error } = await supabase.rpc('relatorio_resumo', { p_de: d, p_ate: a })
    if (error) return null

    const linha = (data as Record<string, unknown>[] | null)?.[0]
    if (linha === undefined) return null

    const faturamento = numero(linha.faturamento)
    const vendas = numero(linha.vendas)
    const ticket_medio = numero(linha.ticket_medio)
    if (faturamento === null || vendas === null || ticket_medio === null) return null

    return { faturamento, vendas, ticket_medio }
  }

  if (consulta.consulta === 'formas_pagamento') {
    const { data, error } = await supabase.rpc('relatorio_formas_pagamento', { p_de: de, p_ate: ate })
    if (error) return null

    const formas = ((data ?? []) as Record<string, unknown>[]).map((linha) => ({
      forma: String(linha.forma),
      quantidade: numero(linha.quantidade) ?? 0,
      total: numero(linha.total) ?? 0,
    }))
    return { consulta: 'formas_pagamento', periodo, formas }
  }

  if (consulta.consulta === 'lucro') {
    const { data, error } = await supabase.rpc('relatorio_lucro', { p_de: de, p_ate: ate })
    if (error) return null

    const linha = (data as Record<string, unknown>[] | null)?.[0]
    if (linha === undefined) return null

    const receita = numero(linha.receita)
    const custo = numero(linha.custo)
    const lucro = numero(linha.lucro)
    if (receita === null || custo === null || lucro === null) return null

    const resultado: ResultadoLucro = { receita, custo, lucro }
    return { consulta: 'lucro', periodo, lucro: resultado }
  }

  if (consulta.consulta === 'comparacao') {
    // O periodo ANTERIOR tem o MESMO tamanho e termina no dia antes de `de`.
    const tamanho = diasInclusivos(de, ate)
    const anteriorAte = somarDias(de, -1)
    const anteriorDe = somarDias(de, -tamanho)

    const [atual, anterior] = await Promise.all([lerResumo(de, ate), lerResumo(anteriorDe, anteriorAte)])
    if (atual === null || anterior === null) return null

    return {
      consulta: 'comparacao',
      periodo,
      atual,
      anteriorPeriodo: { de: anteriorDe, ate: anteriorAte },
      anterior,
    }
  }

  // `faturamento` e `ticket_medio` leem o mesmo resumo.
  const resumo = await lerResumo(de, ate)
  if (resumo === null) return null
  return { consulta: consulta.consulta, periodo, resumo }
}

export async function POST(request: Request) {
  // Minor 1 da revisao final: uma excecao de Auth/`cookies()` (env ausente, cookie
  // corrompido, Auth fora do ar) NAO pode virar o 500 HTML do Next — isso quebra o
  // contrato `{ erro }` da R6 e a tela cairia no `ERRO_INESPERADO` sem mensagem em
  // portugues. Sem sessao comprovada, a resposta e a mesma de quem nao tem sessao
  // (401 com `{ erro }`), decidida num unico lugar: a orquestracao.
  let autenticacao: { sessao: boolean; perfil: Perfil | null }
  try {
    autenticacao = await autenticacaoAtual()
  } catch {
    autenticacao = { sessao: false, perfil: null }
  }
  const { sessao, perfil } = autenticacao

  // Corpo torto nao e erro tecnico: vira `undefined` e a validacao da
  // orquestracao responde a mesma recusa de pergunta ausente.
  let pergunta: unknown
  try {
    const corpo: unknown = await request.json()
    pergunta =
      typeof corpo === 'object' && corpo !== null
        ? (corpo as Record<string, unknown>).pergunta
        : undefined
  } catch {
    pergunta = undefined
  }

  const deps: Deps = {
    agora: () => new Date(),
    classificar,
    // O GRAFO ligado: as tres dependencias existem, entao `processarPergunta` roda
    // o coordenador primeiro e reserva DUAS chamadas por pergunta.
    classificarAssunto,
    classificarFinanceiro,
    consultarFinanceiro,
    reservar,
    reconciliar,
    liberar,
    consultar,
  }

  const { status, corpo } = await processarPergunta({ sessao, perfil, pergunta }, deps)

  return NextResponse.json(corpo, { status })
}
