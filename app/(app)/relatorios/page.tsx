import { perfilAtual } from '@/lib/auth/perfil'
import { formatarMoeda } from '@/lib/format'
import { criarClienteServidor } from '@/lib/supabase/server'
import { atalhos, diasDoPeriodo, formatarDataCivil, ticketMedio, validarPeriodo } from './periodo'
import AtalhoPeriodo from './atalho-periodo'

type ParametroPeriodo = string | string[] | undefined

type Resumo = { faturamento: number; vendas: number; ticket_medio: number }
type Lucro = { receita: number; custo: number; lucro: number }
type FormaPagamento = { forma: string; quantidade: number; total: number }
type MaisVendido = { produto_id: string; nome: string; quantidade: number; total: number }

function primeiro(valor: ParametroPeriodo): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string | string[]; ate?: string | string[] }>
}) {
  const params = await searchParams
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const { periodo, aviso } = validarPeriodo(primeiro(params.de), primeiro(params.ate), hoje)

  const [supabase, perfil] = await Promise.all([criarClienteServidor(), perfilAtual()])
  const ehDono = perfil?.papel === 'dono'

  const consultas = [
    supabase.rpc('relatorio_resumo', { p_de: periodo.de, p_ate: periodo.ate }),
    supabase.rpc('relatorio_formas_pagamento', { p_de: periodo.de, p_ate: periodo.ate }),
    supabase.rpc('relatorio_mais_vendidos', {
      p_de: periodo.de,
      p_ate: periodo.ate,
      p_limite: 10,
    }),
  ] as const
  const [resumoResult, formasResult, vendidosResult, lucroResult] = await Promise.all([
    ...consultas,
    ...(ehDono
      ? [supabase.rpc('relatorio_lucro', { p_de: periodo.de, p_ate: periodo.ate })]
      : [Promise.resolve(null)]),
  ])

  const erro = resumoResult.error || formasResult.error || vendidosResult.error || lucroResult?.error
  const resumo = ((resumoResult.data as Resumo[] | null)?.[0] ?? {
    faturamento: 0,
    vendas: 0,
    ticket_medio: 0,
  })
  const lucro = (lucroResult?.data as Lucro[] | null)?.[0]
  const formas = (formasResult.data ?? []) as FormaPagamento[]
  const maisVendidos = (vendidosResult.data ?? []) as MaisVendido[]
  const quantidadeDias = diasDoPeriodo(periodo)
  const rotuloPeriodo =
    quantidadeDias === 1
      ? '1 dia'
      : `${quantidadeDias} dias`

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-800">Relatórios</h1>

      <form
        id="filtro-periodo"
        key={`${primeiro(params.de) ?? ''}:${primeiro(params.ate) ?? ''}`}
        method="get"
        className="mt-6 rounded-2xl bg-white p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium text-slate-700">
            De
            <input
              type="date"
              name="de"
              data-testid="periodo-de"
              defaultValue={periodo.de}
              className="mt-1 block rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Até
            <input
              type="date"
              name="ate"
              data-testid="periodo-ate"
              defaultValue={periodo.ate}
              className="mt-1 block rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-slate-800 px-5 py-3 text-base font-medium text-white hover:bg-slate-700"
          >
            Ver
          </button>
        </div>
        <nav aria-label="Atalhos de período" className="mt-4 flex flex-wrap gap-2">
          {atalhos(hoje).map(({ rotulo, periodo: atalho }) => {
            const testId =
              rotulo === 'Hoje'
                ? 'periodo-hoje'
                : rotulo === 'Ontem'
                  ? 'periodo-ontem'
                  : rotulo === '7 dias'
                    ? 'periodo-7dias'
                    : 'periodo-mes'
            return (
              <AtalhoPeriodo
                key={rotulo}
                href={`/relatorios?de=${atalho.de}&ate=${atalho.ate}`}
                testId={testId}
              >
                {rotulo}
              </AtalhoPeriodo>
            )
          })}
        </nav>
      </form>

      {aviso ? (
        <p
          data-testid="aviso-periodo"
          className="mt-4 rounded-2xl bg-amber-50 p-4 text-base text-amber-800"
        >
          Período inválido no endereço. Mostrando hoje.
        </p>
      ) : null}

      <p className="mt-5 text-sm text-slate-500">
        {rotuloPeriodo} · {formatarDataCivil(periodo.de)} a {formatarDataCivil(periodo.ate)}
      </p>

      {erro ? (
        <p
          role="alert"
          data-testid="erro-relatorio"
          className="mt-5 rounded-2xl bg-red-50 p-8 text-lg text-red-700 shadow-sm"
        >
          Não foi possível carregar os relatórios. Recarregue.
        </p>
      ) : (
        <>
          <section className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <article data-testid="card-faturamento" className="rounded-2xl bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-500">Faturamento</p>
              <p className="mt-2 text-3xl font-semibold text-slate-800">
                {formatarMoeda(Number(resumo.faturamento))}
              </p>
            </article>
            <article data-testid="card-vendas" className="rounded-2xl bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-500">Vendas</p>
              <p className="mt-2 text-3xl font-semibold text-slate-800">
                {Number(resumo.vendas)}
              </p>
            </article>
            <article data-testid="card-ticket" className="rounded-2xl bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-500">Ticket médio</p>
              <p className="mt-2 text-3xl font-semibold text-slate-800">
                {formatarMoeda(ticketMedio(Number(resumo.faturamento), Number(resumo.vendas)))}
              </p>
            </article>
            {ehDono && lucro ? (
              <article data-testid="card-lucro" className="rounded-2xl bg-white p-6 shadow-sm">
                <p className="text-sm text-slate-500">Lucro</p>
                <p className="mt-2 text-3xl font-semibold text-slate-800">
                  {formatarMoeda(Number(lucro.lucro))}
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  Receita {formatarMoeda(Number(lucro.receita))} · Custo{' '}
                  {formatarMoeda(Number(lucro.custo))}
                </p>
              </article>
            ) : null}
          </section>

          <section data-testid="formas-pagamento" className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800">Formas de pagamento</h2>
            {formas.length === 0 ? (
              <p className="mt-4 text-base text-slate-500">Nenhum pagamento no período.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {formas.map((forma) => (
                  <li
                    key={forma.forma}
                    data-testid="linha-forma"
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <span className="text-base font-medium text-slate-800">
                      {forma.forma} <span className="text-slate-500">· {Number(forma.quantidade)}</span>
                    </span>
                    <span className="text-lg font-semibold text-slate-800">
                      {formatarMoeda(Number(forma.total))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section data-testid="mais-vendidos" className="mt-5 rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800">Mais vendidos</h2>
            {maisVendidos.length === 0 ? (
              <p className="mt-4 text-base text-slate-500">Nenhum produto vendido no período.</p>
            ) : (
              <ol className="mt-3 divide-y divide-slate-100">
                {maisVendidos.map((produto) => (
                  <li
                    key={produto.produto_id}
                    data-testid="linha-vendido"
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <span className="text-base font-medium text-slate-800">
                      {produto.nome} <span className="text-slate-500">· {Number(produto.quantidade)} un.</span>
                    </span>
                    <span className="text-lg font-semibold text-slate-800">
                      {formatarMoeda(Number(produto.total))}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  )
}
