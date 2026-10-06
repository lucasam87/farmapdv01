import Link from 'next/link'
import { notFound } from 'next/navigation'
import { criarClienteServidor } from '@/lib/supabase/server'
import { formatarMoeda, formatarDataHora } from '@/lib/format'
import { FormularioProduto } from '../formulario'
import { FormularioEstoque } from '../formulario-estoque'

type Produto = {
  id: string
  codigo_barras: string | null
  nome: string
  categoria: string | null
  unidade: string
  preco_custo: number
  preco_venda: number
  estoque_atual: number
  estoque_minimo: number
  ativo: boolean
  atualizado_em: string
}

type Movimento = {
  id: string
  tipo: string
  quantidade: number
  saldo_apos: number
  motivo: string | null
  criado_em: string
}

const TIPO: Record<string, string> = {
  entrada: 'Entrada',
  venda: 'Venda',
  ajuste: 'Ajuste',
  cancelamento: 'Cancelamento',
}

export default async function ProdutoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ editar?: string }>
}) {
  const { id } = await params
  const { editar } = await searchParams
  const supabase = await criarClienteServidor()

  const { data } = await supabase
    .from('produtos')
    .select(
      'id, codigo_barras, nome, categoria, unidade, preco_custo, preco_venda, estoque_atual, estoque_minimo, ativo, atualizado_em',
    )
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()
  const produto = data as Produto

  const { data: movimentos } = await supabase
    .from('estoque_movimentos')
    .select('id, tipo, quantidade, saldo_apos, motivo, criado_em')
    .eq('produto_id', id)
    .order('criado_em', { ascending: false })
    .limit(20)

  if (editar) {
    return <FormularioProduto produto={produto} />
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/produtos" className="text-base text-slate-600 underline">
        ← Produtos
      </Link>

      <div className="mt-4 rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">{produto.nome}</h1>
            <p className="mt-1 text-base text-slate-500">
              {produto.codigo_barras ?? 'sem código de barras'} · {produto.categoria ?? 'sem categoria'} ·{' '}
              {produto.unidade}
            </p>
          </div>
          <Link
            href={`/produtos/${produto.id}?editar=1`}
            className="rounded-lg border border-slate-300 px-5 py-3 text-base font-medium text-slate-700 hover:bg-slate-100"
          >
            Editar
          </Link>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-slate-500">Estoque</dt>
            <dd className="text-2xl font-semibold text-slate-800">{produto.estoque_atual}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Mínimo</dt>
            <dd className="text-2xl font-semibold text-slate-800">{produto.estoque_minimo}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Custo</dt>
            <dd className="text-lg text-slate-700">{formatarMoeda(produto.preco_custo)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Venda</dt>
            <dd className="text-lg text-slate-700">{formatarMoeda(produto.preco_venda)}</dd>
          </div>
        </dl>

        {!produto.ativo ? (
          <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-base text-amber-800">
            Produto inativo: não aparece na busca do PDV.
          </p>
        ) : null}
      </div>

      <section className="mt-6 rounded-2xl bg-white p-8 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-800">Movimentar estoque</h2>
        <div className="mt-4">
          <FormularioEstoque produtoId={produto.id} />
        </div>
      </section>

      <section className="mt-6 rounded-2xl bg-white p-8 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-800">Últimos movimentos</h2>
        {(movimentos ?? []).length === 0 ? (
          <p className="mt-4 text-base text-slate-500">
            Nenhum movimento ainda. O saldo só muda por entrada ou ajuste.
          </p>
        ) : (
          <table className="mt-4 w-full text-left text-base">
            <thead>
              <tr className="border-b border-slate-200 text-sm text-slate-500">
                <th className="py-2 pr-4 font-medium">Quando</th>
                <th className="py-2 pr-4 font-medium">Tipo</th>
                <th className="py-2 pr-4 font-medium">Quantidade</th>
                <th className="py-2 pr-4 font-medium">Saldo após</th>
                <th className="py-2 pr-4 font-medium">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {(movimentos as Movimento[]).map((m) => (
                <tr key={m.id} className="border-b border-slate-100 text-slate-700">
                  <td className="py-2 pr-4">{formatarDataHora(m.criado_em)}</td>
                  <td className="py-2 pr-4">{TIPO[m.tipo] ?? m.tipo}</td>
                  <td className={`py-2 pr-4 font-medium ${m.quantidade < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {m.quantidade > 0 ? `+${m.quantidade}` : m.quantidade}
                  </td>
                  <td className="py-2 pr-4">{m.saldo_apos}</td>
                  <td className="py-2 pr-4">{m.motivo ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
