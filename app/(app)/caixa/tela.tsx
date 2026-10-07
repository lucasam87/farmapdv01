'use client'

import { useActionState } from 'react'
import { formatarMoeda, formatarDataHora } from '@/lib/format'
import { abrirCaixa, movimentarCaixa, fecharCaixa, type Resultado } from './actions'

// A tela de caixa (spec 8.3). Existe porque as RPCs de caixa estao prontas e
// testadas desde a Etapa 2, mas NENHUMA etapa da spec construia a tela: o sistema
// nao tinha como abrir o caixa, e sem caixa aberto o PDV recusa vender.
//
// Uma tarefa por tela (spec 10): com o caixa FECHADO, so a abertura; com o caixa
// ABERTO, o resumo, os movimentos e — para o dono — o fechamento.

export type SessaoCaixa = {
  sessao_id: string
  terminal: string
  aberto_em: string
  valor_inicial: number
  vendas_dinheiro: number
  recebimentos_dinheiro: number
  suprimentos: number
  sangrias: number
  cancelamentos: number
  esperado_dinheiro: number
}

export type MovimentoCaixa = {
  id: string
  tipo: string
  forma: string | null
  valor: number
  motivo: string | null
  criado_em: string
}

const CAMPO =
  'rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-500'

const ROTULO_DO_TIPO: Record<string, string> = {
  venda: 'Venda',
  recebimento_crediario: 'Recebimento de crediário',
  sangria: 'Sangria',
  suprimento: 'Suprimento',
  cancelamento: 'Cancelamento',
  ajuste: 'Ajuste',
}

function Recado({ estado }: { estado: Resultado | null }) {
  if (!estado) return null
  return (
    <p
      role={estado.ok ? 'status' : 'alert'}
      data-testid={estado.ok ? 'ok' : 'erro'}
      className={`mt-3 rounded-lg px-4 py-3 text-base ${
        estado.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-700'
      }`}
    >
      {estado.mensagem}
    </p>
  )
}

function Linha({ rotulo, valor, forte = false }: { rotulo: string; valor: number; forte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-sm text-slate-500">{rotulo}</span>
      <span className={forte ? 'text-lg font-semibold text-slate-800' : 'text-base text-slate-700'}>
        {formatarMoeda(valor)}
      </span>
    </div>
  )
}

export function TelaCaixa({
  sessao,
  movimentos,
  ehDono,
}: {
  sessao: SessaoCaixa | null
  movimentos: MovimentoCaixa[]
  ehDono: boolean
}) {
  const [abertura, acaoAbrir, abrindo] = useActionState<Resultado | null, FormData>(abrirCaixa, null)
  const [movimento, acaoMovimentar, movimentando] = useActionState<Resultado | null, FormData>(
    movimentarCaixa,
    null,
  )
  const [fechamento, acaoFechar, fechando] = useActionState<Resultado | null, FormData>(fecharCaixa, null)

  if (!sessao) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold text-slate-800">Caixa</h1>
        <p className="mt-1 text-base text-slate-500">
          Não há caixa aberto. Enquanto o caixa estiver fechado, o PDV recusa vender.
        </p>

        <form action={acaoAbrir} className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
          <label htmlFor="valor_inicial" className="block text-sm font-medium text-slate-700">
            Dinheiro na gaveta para começar (troco)
          </label>
          <input
            id="valor_inicial"
            name="valor_inicial"
            inputMode="decimal"
            placeholder="0,00"
            className={`${CAMPO} mt-2 w-full`}
          />
          <p className="mt-2 text-sm text-slate-500">
            Pode deixar vazio se a gaveta começa vazia.
          </p>
          <button
            type="submit"
            disabled={abrindo}
            className="mt-5 rounded-lg bg-emerald-700 px-6 py-3 text-base font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
          >
            {abrindo ? 'Abrindo…' : 'Abrir caixa'}
          </button>
          <Recado estado={abertura} />
        </form>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-800">Caixa aberto</h1>
        <p className="text-sm text-slate-500">
          terminal {sessao.terminal} · desde {formatarDataHora(sessao.aberto_em)}
        </p>
      </div>

      {/* A conta da spec 8.3, aberta linha a linha: o dono confere de onde veio o
          esperado, e nao so o total. */}
      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <Linha rotulo="Valor inicial" valor={sessao.valor_inicial} />
        <Linha rotulo="Vendas em dinheiro" valor={sessao.vendas_dinheiro} />
        <Linha rotulo="Recebimentos de crediário" valor={sessao.recebimentos_dinheiro} />
        <Linha rotulo="Suprimentos" valor={sessao.suprimentos} />
        <Linha rotulo="Sangrias" valor={-sessao.sangrias} />
        <Linha rotulo="Cancelamentos em dinheiro" valor={-sessao.cancelamentos} />
        <div className="mt-3 border-t border-slate-200 pt-3">
          <Linha rotulo="Esperado na gaveta agora" valor={sessao.esperado_dinheiro} forte />
        </div>
      </section>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800">Movimento de dinheiro</h2>
        <p className="mt-1 text-sm text-slate-500">
          Sangria é dinheiro que sai (depósito, pagamento). Suprimento é dinheiro que entra (troco).
        </p>
        <form action={acaoMovimentar} className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-3">
            <label className="sr-only" htmlFor="tipo">
              Tipo do movimento
            </label>
            <select id="tipo" name="tipo" className={`${CAMPO} w-40`} defaultValue="sangria">
              <option value="sangria">Sangria (sai)</option>
              <option value="suprimento">Suprimento (entra)</option>
            </select>
            <input
              name="valor"
              inputMode="decimal"
              placeholder="Valor"
              aria-label="Valor do movimento"
              className={`${CAMPO} w-32`}
            />
            <input
              name="motivo"
              placeholder="Motivo"
              aria-label="Motivo do movimento"
              className={`${CAMPO} flex-1`}
            />
          </div>
          <button
            type="submit"
            disabled={movimentando}
            className="rounded-lg border border-slate-300 px-5 py-3 text-base text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {movimentando ? 'Lançando…' : 'Lançar movimento'}
          </button>
          <Recado estado={movimento} />
        </form>

        {movimentos.length > 0 ? (
          <ul className="mt-5 divide-y divide-slate-100 text-sm">
            {movimentos.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-4 py-2">
                <span className="text-slate-600">
                  {ROTULO_DO_TIPO[m.tipo] ?? m.tipo}
                  {m.forma ? ` (${m.forma})` : ''}
                  {m.motivo ? ` — ${m.motivo}` : ''}
                </span>
                <span className="whitespace-nowrap text-slate-700">
                  {formatarMoeda(m.valor)}
                  <span className="ml-2 text-slate-400">{formatarDataHora(m.criado_em)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Nenhum movimento ainda.</p>
        )}
      </section>

      {ehDono ? (
        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800">Fechar o caixa</h2>
          <p className="mt-1 text-sm text-slate-500">
            Conte o dinheiro da gaveta. Se não bater com o esperado, a diferença precisa de
            observação. Depois de fechado, o caixa não muda mais.
          </p>
          <form action={acaoFechar} className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-3">
              <input
                name="valor_contado"
                inputMode="decimal"
                placeholder="Contado"
                aria-label="Valor contado na gaveta"
                className={`${CAMPO} w-40`}
              />
              <input
                name="observacao"
                placeholder="Observação (obrigatória se houver diferença)"
                aria-label="Observação do fechamento"
                className={`${CAMPO} flex-1`}
              />
            </div>
            <button
              type="submit"
              disabled={fechando}
              className="rounded-lg bg-slate-800 px-6 py-3 text-base font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {fechando ? 'Fechando…' : 'Fechar caixa'}
            </button>
            <Recado estado={fechamento} />
          </form>
        </section>
      ) : null}
    </div>
  )
}
