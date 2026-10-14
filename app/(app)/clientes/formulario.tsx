'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { salvarCliente, type Resultado } from './actions'

// Formulario de cliente (spec 10: uma tarefa por tela). Client component porque o
// recado do servidor aparece sem recarregar, igual a caixa/tela.tsx.
//
// O QUE O ATENDENTE NAO VE: limite, "bloqueado" e saldo inicial. Nao e so
// esconder o campo — o campo nem e renderizado, e a action manda `null` nesses
// tres (ver clientes/actions.ts): `cliente_salvar` recusaria a edicao inteira se
// recebesse `0` no lugar do limite que o dono ja tinha liberado.

export type ClienteForm = {
  id: string
  nome: string
  telefone: string | null
  cpf: string | null
  limite_credito: number
  bloqueado: boolean
  observacao: string | null
}

const CAMPO =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-500'
const ROTULO = 'mt-4 block text-sm font-medium text-slate-700'

/** Centavos -> "100,00" para o campo de texto (a leitura de volta e parsearCentavos). */
function reais(centavos: number): string {
  return (centavos / 100).toFixed(2).replace('.', ',')
}

function Recado({ estado }: { estado: Resultado | null }) {
  if (!estado) return null
  return (
    <p
      role={estado.ok ? 'status' : 'alert'}
      data-testid={estado.ok ? 'ok' : 'erro'}
      className={`mt-4 rounded-lg px-4 py-3 text-base ${
        estado.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-700'
      }`}
    >
      {estado.mensagem}
    </p>
  )
}

export function FormularioCliente({
  cliente,
  ehDono,
}: {
  cliente: ClienteForm | null
  ehDono: boolean
}) {
  const [estado, acao, enviando] = useActionState<Resultado | null, FormData>(salvarCliente, null)

  return (
    <form action={acao} className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-800">
        {cliente ? 'Editar cliente' : 'Novo cliente'}
      </h1>

      <Recado estado={estado} />

      <input type="hidden" name="cliente_id" value={cliente?.id ?? ''} />

      <label htmlFor="nome" className={ROTULO}>
        Nome
      </label>
      <input id="nome" name="nome" required defaultValue={cliente?.nome ?? ''} className={CAMPO} />

      <label htmlFor="telefone" className={ROTULO}>
        Telefone
      </label>
      <input
        id="telefone"
        name="telefone"
        inputMode="tel"
        placeholder="11 91234-5678"
        defaultValue={cliente?.telefone ?? ''}
        className={CAMPO}
      />

      <label htmlFor="cpf" className={ROTULO}>
        CPF
      </label>
      <input
        id="cpf"
        name="cpf"
        inputMode="numeric"
        placeholder="só os 11 dígitos"
        defaultValue={cliente?.cpf ?? ''}
        className={CAMPO}
      />

      <label htmlFor="observacao" className={ROTULO}>
        Observação
      </label>
      <textarea
        id="observacao"
        name="observacao"
        rows={3}
        defaultValue={cliente?.observacao ?? ''}
        className={CAMPO}
      />

      {ehDono ? (
        <>
          <label htmlFor="limite_credito" className={ROTULO}>
            Limite de crédito
          </label>
          <input
            id="limite_credito"
            name="limite_credito"
            inputMode="decimal"
            placeholder="0,00"
            defaultValue={cliente ? reais(cliente.limite_credito) : ''}
            className={CAMPO}
          />
          <p className="mt-1 text-sm text-slate-500">
            Zero significa que o cliente não faz crediário.
          </p>

          <label className="mt-4 flex items-center gap-2 text-base text-slate-700">
            <input
              type="checkbox"
              name="bloqueado"
              value="sim"
              defaultChecked={cliente?.bloqueado ?? false}
              className="h-5 w-5"
            />
            Cliente bloqueado (o PDV recusa crediário para ele)
          </label>

          <label htmlFor="saldo_inicial" className={ROTULO}>
            Saldo devedor inicial
          </label>
          <input
            id="saldo_inicial"
            name="saldo_inicial"
            inputMode="decimal"
            placeholder="0,00"
            className={CAMPO}
          />
          {/* NUNCA preencher com o saldo ja existente: o saldo devedor nao e uma
              coluna, e um lancamento — reenviar o valor faria a RPC recusar a
              edicao inteira ('Este cliente já tem um saldo inicial lançado.'). */}
          <p className="mt-1 text-sm text-slate-500">
            {cliente
              ? 'Só um saldo inicial por cliente. Deixe vazio para não lançar nada.'
              : 'O que o cliente já devia no sistema antigo. Deixe vazio se não deve nada.'}
          </p>
        </>
      ) : (
        <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-base text-slate-600">
          Limite e bloqueio são do dono.
        </p>
      )}

      <div className="mt-8 flex items-center gap-4">
        <button
          type="submit"
          disabled={enviando}
          className="rounded-lg bg-slate-800 px-6 py-3 text-base font-medium text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {enviando ? 'Salvando…' : 'Salvar'}
        </button>
        <Link href="/clientes" className="text-base text-slate-600 underline">
          Cancelar
        </Link>
      </div>
    </form>
  )
}
