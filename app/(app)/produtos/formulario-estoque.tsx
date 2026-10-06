'use client'

import { useActionState } from 'react'
import { registrarEntrada, registrarAjuste, type ResultadoAcao } from './actions'

const CAMPO =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-500'
const ROTULO = 'mt-2 block text-sm font-medium text-slate-700'
const BOTAO =
  'mt-4 rounded-lg bg-slate-800 px-5 py-3 text-base font-medium text-white hover:bg-slate-700 disabled:opacity-60'

/**
 * Entrada (soma) e Ajuste (grava o delta do inventario). Os dois exigem motivo,
 * e o ajuste nao aceita o saldo que ja esta — o livro-razao proibe movimento zero.
 * `compacto` existe para a tela de estoque, onde o formulario fica dentro de um
 * <details> de cada linha.
 */
export function FormularioEstoque({
  produtoId,
  compacto = false,
}: {
  produtoId: string
  compacto?: boolean
}) {
  const [entrada, acaoEntrada, enviandoEntrada] = useActionState<ResultadoAcao | null, FormData>(
    registrarEntrada,
    null,
  )
  const [ajuste, acaoAjuste, enviandoAjuste] = useActionState<ResultadoAcao | null, FormData>(
    registrarAjuste,
    null,
  )

  return (
    <div className={compacto ? 'grid gap-6 sm:grid-cols-2' : 'grid gap-8 sm:grid-cols-2'}>
      <form action={acaoEntrada} className="rounded-xl bg-slate-50 p-4">
        <p className="text-base font-medium text-slate-700">Entrada de estoque</p>
        <input type="hidden" name="produto_id" value={produtoId} />

        <label htmlFor={`qtd-${produtoId}`} className={ROTULO}>
          Quantidade
        </label>
        <input id={`qtd-${produtoId}`} name="quantidade" inputMode="numeric" required className={CAMPO} />

        <label htmlFor={`custo-${produtoId}`} className={ROTULO}>
          Custo (opcional)
        </label>
        <input id={`custo-${produtoId}`} name="custo" inputMode="decimal" placeholder="deixe vazio para manter" className={CAMPO} />

        <label htmlFor={`motivo-e-${produtoId}`} className={ROTULO}>
          Motivo
        </label>
        <input id={`motivo-e-${produtoId}`} name="motivo" required className={CAMPO} />

        <button type="submit" disabled={enviandoEntrada} className={BOTAO}>
          {enviandoEntrada ? 'Lançando…' : 'Lançar entrada'}
        </button>

        {entrada && !entrada.ok ? (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {entrada.mensagem}
          </p>
        ) : null}
        {entrada?.ok ? <p className="mt-3 text-sm text-emerald-700">Entrada lançada.</p> : null}
      </form>

      <form action={acaoAjuste} className="rounded-xl bg-slate-50 p-4">
        <p className="text-base font-medium text-slate-700">Ajuste de inventário</p>
        <input type="hidden" name="produto_id" value={produtoId} />

        <label htmlFor={`saldo-${produtoId}`} className={ROTULO}>
          Saldo contado na prateleira
        </label>
        <input id={`saldo-${produtoId}`} name="novo_saldo" inputMode="numeric" required className={CAMPO} />

        <label htmlFor={`motivo-a-${produtoId}`} className={ROTULO}>
          Motivo
        </label>
        <input id={`motivo-a-${produtoId}`} name="motivo" required className={CAMPO} />

        <button type="submit" disabled={enviandoAjuste} className={BOTAO}>
          {enviandoAjuste ? 'Ajustando…' : 'Lançar ajuste'}
        </button>

        {ajuste && !ajuste.ok ? (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {ajuste.mensagem}
          </p>
        ) : null}
        {ajuste?.ok ? <p className="mt-3 text-sm text-emerald-700">Estoque ajustado.</p> : null}
      </form>
    </div>
  )
}
