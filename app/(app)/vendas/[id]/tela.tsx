'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { formatarMoeda } from '@/lib/format'
import { dataHoraDe, type VendaHistorico } from '../dia'
import { cancelarVenda, type Resultado } from './actions'

// A tela da venda (spec §10: uma tarefa por tela, detalhe ao clicar). Ela existe
// para responder duas perguntas do balcão: "o que foi vendido?" e "posso desfazer?".
//
// Nada de conta aqui: `dia` vem pronto da view (fuso de São Paulo) e o dinheiro é
// inteiro em centavos — a conversão para reais acontece só em `formatarMoeda`.
// Com `ocultar` ligado, NENHUM valor sai daqui formatado (nem unitário, nem total).

export type ItemVenda = {
  id: string
  nome_produto: string
  quantidade: number
  preco_unitario: number
  total: number
}

export type PagamentoVenda = {
  id: string
  forma: string
  valor: number
}

const CAMPO =
  'rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-500'

const FORMA: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Débito',
  credito: 'Crédito',
  crediario: 'Crediário',
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

function Linha({ rotulo, valor, forte = false }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-sm text-slate-500">{rotulo}</span>
      <span className={forte ? 'text-lg font-semibold text-slate-800' : 'text-base text-slate-700'}>
        {valor}
      </span>
    </div>
  )
}

export function TelaVenda({
  venda,
  itens,
  pagamentos,
  oculto,
  ehDono,
  rotulo,
}: {
  venda: VendaHistorico
  itens: ItemVenda[]
  pagamentos: PagamentoVenda[]
  oculto: boolean
  ehDono: boolean
  rotulo: string
}) {
  const [resultado, acaoCancelar, cancelando] = useActionState<Resultado | null, FormData>(
    cancelarVenda,
    null,
  )

  const cancelada = venda.status === 'cancelada'

  function valor(centavos: number): string {
    return oculto ? '••••' : formatarMoeda(centavos)
  }

  // Ocultar valores vive no endereço (spec §10). O detalhe recebe a marca e tem
  // de devolvê-la no único link que sai daqui — senão a volta para a lista
  // mostraria os valores de novo.
  const voltar = oculto ? `/vendas?dia=${venda.dia}&ocultar=1` : `/vendas?dia=${venda.dia}`

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={voltar} className="text-base text-slate-600 underline">
          Voltar para o dia
        </Link>
        <p className="text-sm text-slate-500">Vendas de {rotulo}</p>
      </div>

      <div className="mt-4 rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Venda {venda.numero}</h1>
            <p className="mt-1 text-base text-slate-500">
              {dataHoraDe(venda.criado_em)} · {venda.cliente_nome ?? 'sem cliente'}
            </p>
          </div>
          <p
            data-testid="status-venda"
            className={`rounded-lg px-4 py-2 text-base font-medium ${
              cancelada ? 'bg-slate-200 text-slate-700' : 'bg-emerald-50 text-emerald-900'
            }`}
          >
            {cancelada ? 'Cancelada' : 'Concluída'}
          </p>
        </div>

        {cancelada ? (
          // `cancelado_em` pode vir nulo (venda cancelada antes de a coluna existir):
          // `dataHoraDe(null)` devolveria nada no meio de um texto. Por isso o nulo
          // é protegido ANTES de chamar a função.
          <div
            data-testid="bloco-cancelada"
            className="mt-6 rounded-lg bg-slate-100 px-4 py-3 text-base text-slate-700"
          >
            {venda.cancelado_em ? `Cancelada em ${dataHoraDe(venda.cancelado_em)}` : 'Cancelada'}
            {venda.cancelado_por_nome ? ` por ${venda.cancelado_por_nome}` : ''}
            {venda.motivo_cancelamento ? `: ${venda.motivo_cancelamento}` : ''}
          </div>
        ) : null}
      </div>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800">Pagamento</h2>
        {pagamentos.length === 0 ? (
          <p className="mt-2 text-base text-slate-500">Nenhum pagamento registrado.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {pagamentos.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-4 py-2 text-base">
                <span className="text-slate-600">{FORMA[p.forma] ?? p.forma}</span>
                <span className="text-slate-700">{valor(p.valor)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t border-slate-200 pt-3">
          <Linha rotulo="Subtotal" valor={valor(venda.subtotal)} />
          <Linha rotulo="Desconto" valor={valor(venda.desconto)} />
          <Linha rotulo="Troco" valor={valor(venda.troco)} />
          <Linha rotulo="Total" valor={valor(venda.total)} forte />
        </div>
      </section>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800">Itens</h2>
        <div data-testid="itens" className="mt-2">
          {itens.length === 0 ? (
            <p className="text-base text-slate-500">Nenhum item nesta venda.</p>
          ) : (
            <table className="w-full text-left text-base">
              <thead>
                <tr className="border-b border-slate-200 text-sm text-slate-500">
                  <th className="py-2 pr-4 font-medium">Qtd</th>
                  <th className="py-2 pr-4 font-medium">Produto</th>
                  <th className="py-2 pr-4 font-medium">Unitário</th>
                  <th className="py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 text-slate-700">
                    <td className="py-2 pr-4">{item.quantidade}</td>
                    <td className="py-2 pr-4">{item.nome_produto}</td>
                    <td className="py-2 pr-4">{valor(item.preco_unitario)}</td>
                    <td className="py-2 font-medium">{valor(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {cancelada ? null : ehDono ? (
        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800">Cancelar a venda</h2>
          <p className="mt-1 text-base text-slate-500">
            O estoque volta e o dinheiro sai do caixa. Depois de cancelada, a venda não muda mais.
          </p>
          <form action={acaoCancelar} className="mt-4 space-y-3">
            {/* O id vai escondido: a RPC decide pelo banco, não por um texto do
                endereço, e recusa a venda que não existe. */}
            <input type="hidden" name="venda_id" value={venda.venda_id} />
            <label htmlFor="motivo" className="block text-sm font-medium text-slate-700">
              Motivo do cancelamento
            </label>
            {/* Sem `required`: quem decide se o motivo serve é `validarMotivo`, e o
                recado dela aparece na tela em português. */}
            <input
              id="motivo"
              name="motivo"
              placeholder="Ex.: cliente desistiu"
              className={`${CAMPO} w-full`}
            />
            <button
              type="submit"
              disabled={cancelando}
              className="rounded-lg bg-slate-800 px-6 py-3 text-base font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {cancelando ? 'Cancelando…' : 'Confirmar cancelamento'}
            </button>
          </form>
        </section>
      ) : (
        <p className="mt-6 rounded-2xl bg-slate-100 p-6 text-base text-slate-600">
          Cancelamento é só do dono.
        </p>
      )}

      {/* Fora dos blocos que somem: quando o cancelamento dá certo, a faixa cinza
          entra no lugar do formulário e este recado tem de continuar na tela. */}
      <Recado estado={resultado} />
    </div>
  )
}
