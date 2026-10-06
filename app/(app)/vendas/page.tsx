import Link from 'next/link'
import { criarClienteServidor } from '@/lib/supabase/server'
import { formatarMoeda } from '@/lib/format'

// Casca do historico: o dia de hoje e as vendas dele, com os valores ocultaveis
// (spec 10, como no sistema antigo). O historico completo, o detalhe da venda e o
// cancelamento sao a Etapa 5 — esta tela existe para o PDV ter para onde mandar o
// atendente depois de fechar a venda.

type VendaLista = {
  venda_id: string
  numero: number
  criado_em: string
  cliente_nome: string | null
  total: number
  itens: string | null
}

type ResumoDia = {
  dia: string
  quantidade: number
  total: number
  ticket_medio: number
}

/** A view ja entrega a data no fuso de Sao Paulo. */
function hora(texto: string): string {
  const partes = texto.replace(' ', 'T').match(/T(\d{2}:\d{2})/)
  return partes ? partes[1] : texto
}

export default async function VendasPage({
  searchParams,
}: {
  searchParams: Promise<{ ocultar?: string }>
}) {
  const { ocultar } = await searchParams
  const oculto = Boolean(ocultar)
  const supabase = await criarClienteServidor()

  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  const { data: resumo } = await supabase
    .from('v_vendas_dia')
    .select('dia, quantidade, total, ticket_medio')
    .eq('dia', hoje)
    .maybeSingle()

  const dia = resumo as ResumoDia | null

  const { data: lista } = await supabase
    .from('v_vendas_lista')
    .select('venda_id, numero, criado_em, cliente_nome, total, itens')
    .order('criado_em', { ascending: false })
    .limit(50)

  const vendas = ((lista ?? []) as VendaLista[]).filter((v) => v.criado_em.startsWith(hoje))

  function valor(centavos: number): string {
    return oculto ? '••••' : formatarMoeda(centavos)
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-800">Vendas de hoje</h1>
        <Link
          href={oculto ? '/vendas' : '/vendas?ocultar=1'}
          className="rounded-lg border border-slate-300 px-5 py-3 text-base font-medium text-slate-700 hover:bg-slate-100"
        >
          {oculto ? 'Mostrar valores' : 'Ocultar valores'}
        </Link>
      </div>

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">Vendas</p>
          <p className="text-3xl font-semibold text-slate-800">{dia?.quantidade ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">Total do dia</p>
          <p className="text-3xl font-semibold text-slate-800">{valor(dia?.total ?? 0)}</p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">Ticket médio</p>
          <p className="text-3xl font-semibold text-slate-800">
            {valor(Math.round(Number(dia?.ticket_medio ?? 0) * 100))}
          </p>
        </div>
      </section>

      {vendas.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-white p-8 text-lg text-slate-600 shadow-sm">
          Nenhuma venda hoje ainda. Use <span className="font-medium">Nova venda</span> (F3).
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {vendas.map((v) => (
            <li
              key={v.venda_id}
              data-testid="linha-venda"
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-6 shadow-sm"
            >
              <div>
                <p className="text-lg text-slate-800">
                  Venda {v.numero} · {hora(v.criado_em)}
                </p>
                <p className="mt-1 text-base text-slate-500">
                  {v.cliente_nome ?? 'sem cliente'}
                  {v.itens ? ` · ${v.itens}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl font-semibold text-slate-800">{valor(v.total)}</p>
                <p className="mt-1 text-sm text-slate-400">Detalhe na próxima etapa</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
