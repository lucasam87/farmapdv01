import { NextResponse } from 'next/server'
import { LIMITE_RESULTADOS } from '@/app/(app)/agente/logica'
import { classificar } from '@/lib/agente/deepseek'
import { autenticacaoAtual, type Perfil } from '@/lib/auth/perfil'
import { liberar, reconciliar, reservar } from '@/lib/supabase/privilegiado'
import { criarClienteServidor } from '@/lib/supabase/server'
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
    reservar,
    reconciliar,
    liberar,
    consultar,
  }

  const { status, corpo } = await processarPergunta({ sessao, perfil, pergunta }, deps)

  return NextResponse.json(corpo, { status })
}
