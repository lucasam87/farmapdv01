import Link from 'next/link'
import { criarClienteServidor } from '@/lib/supabase/server'
import { formatarMoeda } from '@/lib/format'
import {
  validarDia,
  diaAnterior,
  diaSeguinte,
  rotuloDoDia,
  horaDe,
  resumirCanceladas,
  type VendaHistorico,
} from './dia'

// Historico de vendas: o dia no endereco, as setas de navegacao, o resumo do dia
// e a venda cancelada marcada na lista (spec 10 e 8.2).
//
// A tela NAO faz conta — nem de dinheiro, nem de fuso, nem de data. `dia` ja vem
// pronto da view (fuso de Sao Paulo) e `validarDia` e a UNICA porta do endereco:
// as funcoes de `./dia` nao validam entrada, entao tudo o que sai daqui ja e um
// dia confiavel. O que o endereco traz de torto vira aviso, nunca erro 500.

type ResumoDia = {
  dia: string
  quantidade: number
  total: number
  ticket_medio: number
}

// Teto de linhas do dia: a lista nao pode travar o balcao num dia atipico.
const LIMITE = 200

const COLUNAS =
  'venda_id, numero, dia, criado_em, cliente_id, cliente_nome, subtotal, desconto, total, troco, itens, formas, status, cancelado_em, cancelado_por_nome, motivo_cancelamento'

export default async function VendasPage({
  searchParams,
}: {
  searchParams: Promise<{ dia?: string; ocultar?: string }>
}) {
  const params = await searchParams
  const oculto = Boolean(params.ocultar)

  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const { dia, aviso } = validarDia(params.dia, hoje)

  const supabase = await criarClienteServidor()

  const { data: resumoBruto } = await supabase
    .from('v_vendas_dia')
    .select('dia, quantidade, total, ticket_medio')
    .eq('dia', dia)
    .maybeSingle()

  const { data: lista } = await supabase
    .from('v_vendas_historico')
    .select(COLUNAS)
    .eq('dia', dia)
    .order('criado_em', { ascending: false })
    .limit(LIMITE)

  const resumo = resumoBruto as ResumoDia | null
  const vendas = (lista ?? []) as VendaHistorico[]
  const canceladas = resumirCanceladas(vendas)
  const rotulo = rotuloDoDia(dia, hoje)

  function valor(centavos: number): string {
    return oculto ? '••••' : formatarMoeda(centavos)
  }

  // Ocultar valores vive no endereco (spec 10). Sem isto, trocar de dia ou abrir
  // uma venda traria os valores de volta: o `ocultar=1` tem de ir junto em todo
  // link que sai desta tela.
  function comOcultar(url: string): string {
    if (!oculto) return url
    return `${url}${url.includes('?') ? '&' : '?'}ocultar=1`
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-800">Vendas — {rotulo}</h1>
        <Link
          data-testid="ocultar"
          href={oculto ? `/vendas?dia=${dia}` : `/vendas?dia=${dia}&ocultar=1`}
          className="rounded-lg border border-slate-300 px-5 py-3 text-base font-medium text-slate-700 hover:bg-slate-100"
        >
          {oculto ? 'Mostrar valores' : 'Ocultar valores'}
        </Link>
      </div>

      <nav className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <Link
          data-testid="dia-anterior"
          href={comOcultar(`/vendas?dia=${diaAnterior(dia)}`)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-base font-medium text-slate-700 hover:bg-slate-100"
        >
          ‹ Dia anterior
        </Link>
        <Link
          data-testid="dia-hoje"
          href={comOcultar('/vendas')}
          className="rounded-lg border border-slate-300 px-4 py-2 text-base font-medium text-slate-700 hover:bg-slate-100"
        >
          Hoje
        </Link>
        <Link
          data-testid="dia-seguinte"
          href={comOcultar(`/vendas?dia=${diaSeguinte(dia)}`)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-base font-medium text-slate-700 hover:bg-slate-100"
        >
          Dia seguinte ›
        </Link>

        <form method="get" className="ml-auto flex flex-wrap items-end gap-2">
          <label className="text-sm font-medium text-slate-700">
            Ver outro dia
            {/* `key={dia}`: sem ele o campo (nao controlado) continuaria mostrando
                o dia anterior depois de navegar pelas setas. */}
            <input
              key={dia}
              type="date"
              name="dia"
              defaultValue={dia}
              className="mt-1 block rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900"
            />
          </label>
          <input type="hidden" name="ocultar" value={oculto ? '1' : ''} />
          <button
            type="submit"
            className="rounded-lg bg-slate-100 px-5 py-2 text-base font-medium text-slate-700 hover:bg-slate-200"
          >
            Ver
          </button>
        </form>
      </nav>

      {aviso ? (
        <p
          data-testid="aviso-dia"
          className="mt-4 rounded-2xl bg-amber-50 p-4 text-base text-amber-800"
        >
          Data inválida no endereço. Mostrando hoje.
        </p>
      ) : null}

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">Vendas</p>
          <p className="text-3xl font-semibold text-slate-800">{resumo?.quantidade ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">Total do dia</p>
          <p className="text-3xl font-semibold text-slate-800">{valor(resumo?.total ?? 0)}</p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">Ticket médio</p>
          {/* A view ja devolve o ticket medio em centavos e ja arredondado: aqui
              so resta formatar (a versao anterior multiplicava por 100 e mostrava
              o ticket medio cem vezes maior). */}
          <p className="text-3xl font-semibold text-slate-800">
            {valor(Math.round(Number(resumo?.ticket_medio ?? 0)))}
          </p>
        </div>
      </section>

      {canceladas.quantidade > 0 ? (
        <p data-testid="resumo-canceladas" className="mt-4 text-base text-slate-600">
          Canceladas: {canceladas.quantidade} · {valor(canceladas.total)}
        </p>
      ) : null}

      {vendas.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-white p-8 text-lg text-slate-600 shadow-sm">
          Nenhuma venda em {rotulo}.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {vendas.map((venda) => {
            const cancelada = venda.status === 'cancelada'
            return (
              <li key={venda.venda_id}>
                {/* A cancelada e a MESMA linha, so marcada: o e2e a procura por
                    `linha-venda` e por `data-cancelada` (um elemento nao pode ter
                    dois `data-testid`). */}
                <Link
                  data-testid="linha-venda"
                  {...(cancelada ? { 'data-cancelada': '1' } : {})}
                  href={comOcultar(`/vendas/${venda.venda_id}?dia=${dia}`)}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl p-6 shadow-sm ${
                    cancelada ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-800'
                  }`}
                >
                  <div>
                    <p className={`text-lg ${cancelada ? 'line-through' : ''}`}>
                      Venda {venda.numero} · {horaDe(venda.criado_em)}
                    </p>
                    <p className={`mt-1 text-base ${cancelada ? 'line-through' : 'text-slate-500'}`}>
                      {venda.cliente_nome ?? 'sem cliente'}
                      {venda.itens ? ` · ${venda.itens}` : ''}
                    </p>
                    {cancelada ? (
                      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                        <span className="rounded bg-slate-300 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
                          Cancelada
                        </span>
                        {venda.motivo_cancelamento ? <span>{venda.motivo_cancelamento}</span> : null}
                      </p>
                    ) : null}
                  </div>
                  <p className={`text-xl font-semibold ${cancelada ? 'line-through' : ''}`}>
                    {valor(venda.total)}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
