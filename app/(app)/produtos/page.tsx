import Link from 'next/link'
import { criarClienteServidor } from '@/lib/supabase/server'
import { formatarMoeda } from '@/lib/format'
import { filtroDeBuscaDeProduto } from '@/lib/postgrest'

// Lista enxuta, uma tarefa por tela (spec 10). O teto de 50 linhas existe porque
// a farmacia tem milhares de produtos: trazer todos e travar a tela do balcao.

const LIMITE = 50

type Produto = {
  id: string
  codigo_barras: string | null
  nome: string
  preco_venda: number
  estoque_atual: number
  estoque_minimo: number
  ativo: boolean
}

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; categoria?: string; inativos?: string }>
}) {
  const { busca, categoria, inativos } = await searchParams
  const supabase = await criarClienteServidor()

  let consulta = supabase
    .from('produtos')
    .select('id, codigo_barras, nome, preco_venda, estoque_atual, estoque_minimo, ativo', {
      count: 'exact',
    })
    .order('nome')
    .limit(LIMITE)

  if (!inativos) consulta = consulta.eq('ativo', true)
  if (categoria) consulta = consulta.eq('categoria', categoria)

  const termo = (busca ?? '').trim()
  if (termo !== '') {
    // Codigo de barras exato OU pedaco do nome: o leitor manda o codigo inteiro,
    // e quem digita procura por pedaco do nome. O termo vai escapado — o `or()`
    // concatena a string do filtro e uma virgula no nome quebraria a consulta
    // (ver lib/postgrest.ts).
    consulta = consulta.or(filtroDeBuscaDeProduto(termo))
  }

  const { data, count } = await consulta
  const produtos = (data ?? []) as Produto[]
  const total = count ?? produtos.length

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-800">Produtos</h1>
        <div className="flex gap-3">
          <Link
            href="/produtos/novo"
            className="rounded-lg bg-slate-800 px-5 py-3 text-base font-medium text-white hover:bg-slate-700"
          >
            Novo produto
          </Link>
          <Link
            href="/produtos/importar"
            className="rounded-lg border border-slate-300 px-5 py-3 text-base font-medium text-slate-700 hover:bg-slate-100"
          >
            Importar planilha
          </Link>
        </div>
      </div>

      <form className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <label htmlFor="busca" className="block text-sm font-medium text-slate-700">
          Buscar por nome ou código de barras
        </label>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <input
            id="busca"
            name="busca"
            defaultValue={termo}
            className="w-full max-w-sm rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900"
          />
          <label className="flex items-center gap-2 text-base text-slate-700">
            <input type="checkbox" name="inativos" value="sim" defaultChecked={Boolean(inativos)} className="h-5 w-5" />
            Mostrar inativos
          </label>
          <button
            type="submit"
            className="rounded-lg bg-slate-100 px-5 py-3 text-base font-medium text-slate-700 hover:bg-slate-200"
          >
            Buscar
          </button>
        </div>
      </form>

      {total > produtos.length ? (
        <p className="mt-4 text-base text-amber-800">
          Mostrando {produtos.length} de {total}. Refine a busca.
        </p>
      ) : null}

      {produtos.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-white p-8 text-lg text-slate-600 shadow-sm">
          Nenhum produto encontrado.
        </p>
      ) : (
        <table className="mt-6 w-full rounded-2xl bg-white text-left text-base shadow-sm">
          <thead>
            <tr className="border-b border-slate-200 text-sm text-slate-500">
              <th className="p-4 font-medium">Código</th>
              <th className="p-4 font-medium">Nome</th>
              <th className="p-4 font-medium">Preço</th>
              <th className="p-4 font-medium">Estoque</th>
            </tr>
          </thead>
          <tbody>
            {produtos.map((p) => {
              const baixo = p.estoque_atual <= p.estoque_minimo
              const zerado = p.estoque_atual === 0
              return (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="p-4 text-slate-500">{p.codigo_barras ?? '—'}</td>
                  <td className="p-4">
                    <Link href={`/produtos/${p.id}`} className="text-slate-800 underline">
                      {p.nome}
                    </Link>
                    {!p.ativo ? <span className="ml-2 text-sm text-slate-400">(inativo)</span> : null}
                  </td>
                  <td className="p-4 text-slate-700">{formatarMoeda(p.preco_venda)}</td>
                  <td className={`p-4 font-medium ${zerado ? 'text-slate-400' : baixo ? 'text-red-700' : 'text-slate-700'}`}>
                    {p.estoque_atual}
                    {baixo && !zerado ? <span className="ml-2 text-sm">baixo</span> : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
