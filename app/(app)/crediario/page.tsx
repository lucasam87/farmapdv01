import Link from 'next/link'
import { criarClienteServidor } from '@/lib/supabase/server'
import { formatarMoeda } from '@/lib/format'
import { filtroDeBuscaDeDevedor } from '@/lib/postgrest'
import { formatarTelefone, linkWhatsApp } from '../clientes/validacao'
import { Receber } from './receber'

// Quem deve, quanto e o recebimento SEM SAIR DA LISTA.
//
// O SALDO NAO E CONTA DESTA TELA: ele vem de `v_clientes_devedores`, a mesma view
// que o PDV, o detalhe do cliente e `/clientes` leem. Recalcular
// "compra − pagamento" aqui seria uma segunda definicao de divida, livre para
// divergir da primeira. A view ja devolve so quem deve, maior saldo primeiro.
//
// O TETO DE 200 E DO BALCAO, NAO DO BANCO: a lista serve para receber hoje, e 200
// linhas cobrem a farmacia inteira; quando corta, a tela diz quantos ficaram de
// fora e declara o total como parcial, em vez de arredondar a verdade — o total a
// receber e a soma do que esta NA TELA.
//
// O RECEBIMENTO E O MESMO FORMULARIO DO DETALHE DO CLIENTE (`Receber`, da Task 4):
// a action `receberDoCliente` confere o teto na tela, chama `receber_pagamento`
// (quem trava de verdade, com o cliente em `for update`) e revalida `/crediario`,
// `/clientes` e `/clientes/[id]` — por isso saldo e total se ajustam sozinhos
// depois de um recebimento, sem esta tela recalcular nada.

const LIMITE = 200

type Devedor = {
  cliente_id: string
  nome: string
  telefone: string | null
  limite_credito: number
  saldo: number
}

export default async function CrediarioPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string }>
}) {
  const { busca } = await searchParams
  const termo = (busca ?? '').trim()
  const supabase = await criarClienteServidor()

  // `count: 'exact'` junto do `limit` e o que permite dizer "mostrando 200 de N"
  // sem uma segunda consulta.
  let consulta = supabase
    .from('v_clientes_devedores')
    .select('cliente_id, nome, telefone, limite_credito, saldo', { count: 'exact' })
    .order('saldo', { ascending: false })
    .limit(LIMITE)

  if (termo !== '') {
    // As clausulas vem do helper (nome OR telefone, escapados e condicionais — a
    // view nao expoe CPF, ver lib/postgrest.ts); o termo nunca entra cru aqui.
    consulta = consulta.or(filtroDeBuscaDeDevedor(termo))
  }

  const { data, count } = await consulta
  const devedores = (data ?? []) as Devedor[]
  const total = count ?? devedores.length
  const cortou = total > devedores.length

  // Tudo em CENTAVOS, direto da view; a conversao para reais e so na exibicao
  // (`formatarMoeda`, spec 11 B3). O `Number()` e explicito porque `soma + saldo`
  // CONCATENARIA se a view devolvesse o bigint como texto — o total sairia 100x
  // menor, que e exatamente o erro de fator 100 que ja apareceu duas vezes aqui.
  const aReceber = devedores.reduce((soma, d) => soma + Number(d.saldo), 0)

  // A legenda diz DE QUE e a soma acima. Busca sem resultado nao e "ninguem
  // deve": os devedores existem, nenhum casa o termo — dizer a outra coisa faria
  // o operador fechar o caixa achando a casa quitada.
  const contagem = devedores.length === 1 ? '1 devedor' : `${devedores.length} devedores`
  const legendaDoTotal =
    devedores.length === 0
      ? termo === ''
        ? 'Nenhum cliente devendo.'
        : 'Nenhum devedor para esta busca.'
      : cortou
        ? `Soma parcial dos ${devedores.length} maiores saldos.`
        : `Soma dos saldos de ${contagem}.`

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-800">Crediário</h1>
      <p className="mt-2 text-base text-slate-500">
        Dinheiro entra no caixa; PIX e cartão baixam a dívida sem mexer no esperado da gaveta. O
        link do WhatsApp só abre a conversa com a mensagem pronta — quem envia é você.
      </p>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Total a receber</p>
        {/* O testid carrega SO o valor: e ele que o teste le para conferir a soma
            dos saldos listados. */}
        <p data-testid="total-a-receber" className="mt-1 text-4xl font-semibold text-red-700">
          {formatarMoeda(aReceber)}
        </p>
        <p className="mt-2 text-base text-slate-500">{legendaDoTotal}</p>
      </section>

      <form className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <label htmlFor="busca" className="block text-sm font-medium text-slate-700">
          Buscar por nome ou telefone
        </label>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <input
            id="busca"
            name="busca"
            data-testid="busca-devedor"
            defaultValue={termo}
            className="w-full max-w-sm rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900"
          />
          <button
            type="submit"
            className="rounded-lg bg-slate-100 px-5 py-3 text-base font-medium text-slate-700 hover:bg-slate-200"
          >
            Buscar
          </button>
        </div>
      </form>

      {cortou ? (
        <p className="mt-4 text-base text-amber-800">
          Mostrando {devedores.length} de {total}. Refine a busca.
        </p>
      ) : null}

      {devedores.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-white p-8 text-lg text-slate-600 shadow-sm">
          {termo === ''
            ? 'Ninguém devendo no crediário. A dívida nasce na venda no crediário ou no saldo inicial.'
            : 'Nenhum devedor para esta busca.'}
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {devedores.map((d) => {
            const telefone = formatarTelefone(d.telefone ?? '')
            // Telefone torto (nem 10 nem 11 digitos) nao ganha mascara, mas
            // tambem nao some: e o numero gravado, e o mesmo que o `linkWhatsApp`
            // usa quando ha digito.
            const contato = telefone ?? (d.telefone?.trim() ? d.telefone : null)
            // O link SO abre o `wa.me` com a mensagem pronta (spec 8.4): sem
            // telefone nao ha link, e a linha diz isso.
            const link = linkWhatsApp(d.telefone, d.nome, d.saldo)

            return (
              <li
                key={d.cliente_id}
                data-testid="linha-devedor"
                className="rounded-2xl bg-white p-6 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <Link
                      href={`/clientes/${d.cliente_id}`}
                      className="text-xl font-semibold text-slate-800 underline"
                    >
                      {d.nome}
                    </Link>
                    <p className="mt-1 text-base text-slate-500">
                      {/* `limite_credito = 0` e "nao faz crediario", NUNCA
                          ilimitado (spec 8.4): mostrar R$ 0,00 convidaria o
                          operador a vender fiado para quem nao tem credito. */}
                      {contato ?? 'sem telefone'} · Limite:{' '}
                      {d.limite_credito > 0 ? formatarMoeda(d.limite_credito) : 'sem crediário'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-500">Deve</p>
                    <p className="text-2xl font-semibold text-red-700">{formatarMoeda(d.saldo)}</p>
                  </div>
                </div>

                <div className="mt-4">
                  {/* O valor ja focado e o pedido da tela: o operador abre o
                      crediario e digita. Sao 200 campos com `autoFocus` no HTML,
                      mas o navegador foca o PRIMEIRO em ordem de documento — o do
                      maior saldo, que e o primeiro que a lista mostra. */}
                  <Receber clienteId={d.cliente_id} nome={d.nome} saldo={d.saldo} focarInicial />
                </div>

                {link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-block rounded-lg border border-emerald-700 px-5 py-3 text-base font-medium text-emerald-800 hover:bg-emerald-50"
                  >
                    Cobrar {d.nome} no WhatsApp
                  </a>
                ) : (
                  <p className="mt-3 text-base text-slate-500">Cliente sem telefone cadastrado.</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
