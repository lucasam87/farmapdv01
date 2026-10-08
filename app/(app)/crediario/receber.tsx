'use client'

import { useActionState } from 'react'
import { receberDoCliente, type Resultado } from './actions'

// Formulario de recebimento do crediario. NASCE na Task 4 porque o detalhe do
// cliente ja recebe pagamento; a Task 5 (lista de devedores) so embute este mesmo
// componente em cada linha — por isso o `data-testid` leva o id do cliente (duas
// linhas na mesma tela nao podem ter o mesmo).
//
// O saldo vai num campo ESCONDIDO so para a validacao de tela (`validarRecebimento`
// no servidor). O teto de verdade e checado dentro de `receber_pagamento`, com o
// cliente travado: campo escondido o operador muda pelo navegador.

const CAMPO =
  'rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-500'

const FORMAS = [
  { forma: 'dinheiro', rotulo: 'Dinheiro' },
  { forma: 'pix', rotulo: 'PIX' },
  { forma: 'debito', rotulo: 'Débito' },
  { forma: 'credito', rotulo: 'Crédito' },
]

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

export function Receber({
  clienteId,
  nome,
  saldo,
  focarInicial = false,
}: {
  clienteId: string
  nome: string
  /** Centavos, da view `v_clientes_devedores` — so para a checagem da tela. */
  saldo: number
  /**
   * A Task 5 pede o valor ja focado na lista de devedores; o detalhe do cliente
   * (uma unica linha) fica com o padrao `false`, para o autoFocus nao competir
   * com a leitura da tela. Opcional de proposito: a interface nasce na Task 4 e
   * a Task 5 nao pode editar este arquivo.
   */
  focarInicial?: boolean
}) {
  const [estado, acao, enviando] = useActionState<Resultado | null, FormData>(receberDoCliente, null)

  return (
    <form action={acao} data-testid={`receber-${clienteId}`} className="space-y-3">
      <input type="hidden" name="cliente_id" value={clienteId} />
      <input type="hidden" name="saldo" value={saldo} />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor={`receber-valor-${clienteId}`}
            className="block text-sm font-medium text-slate-700"
          >
            Valor recebido
          </label>
          <input
            id={`receber-valor-${clienteId}`}
            name="valor"
            inputMode="decimal"
            placeholder="0,00"
            required
            autoFocus={focarInicial}
            className={`${CAMPO} mt-1 w-32`}
          />
        </div>

        <div>
          <label
            htmlFor={`receber-forma-${clienteId}`}
            className="block text-sm font-medium text-slate-700"
          >
            Forma
          </label>
          <select
            id={`receber-forma-${clienteId}`}
            name="forma"
            defaultValue="dinheiro"
            className={`${CAMPO} mt-1`}
          >
            {FORMAS.map((f) => (
              <option key={f.forma} value={f.forma}>
                {f.rotulo}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={enviando}
          className="rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
        >
          {enviando ? 'Recebendo…' : `Receber de ${nome}`}
        </button>
      </div>

      <Recado estado={estado} />
    </form>
  )
}
