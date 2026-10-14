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
  // `string[]` e possivel: `?busca=a&busca=b` chega assim, e nem `trim` nem `eq`
  // funcionam em array — sem a guarda a rota estoura (500) por causa da URL.
  // (`/clientes` e `/crediario` ja nasceram com ela; faltava aqui.)
  searchParams: Promise<{ busca?: string | string[]; categoria?: string | string[]; inativos?: string }>
}) {
  const { busca, categoria, inativos } = await searchParams
  const categoriaUnica = Array.isArray(categoria) ? (categoria[0] ?? '') : (categoria ?? '')
  const supabase = await criarClienteServidor()

  let consulta = supabase
    .from('produtos')
    .select('id, codigo_barras, nome, preco_venda, estoque_atual, estoque_minimo, ativo', {
      count: 'exact',
    })
    .order('nome')
    .limit(LIMITE)

  if (!inativos) consulta = consulta.eq('ativo', true)
  if (categoriaUnica !== '') consulta = consulta.eq('categoria', categoriaUnica)

  const termo = (Array.isArray(busca) ? (busca[0] ?? '') : (busca ?? '')).trim()
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
        <h1 className="text-2xl font-semibold text-foreground">Produtos</h1>
        <div className="flex gap-3">
          <Link
            href="/produtos/novo"
            className="rounded-lg bg-primary px-5 py-3 text-base font-medium text-primary-foreground hover:opacity-90"
          >
            Novo produto
          </Link>
          <Link
            href="/produtos/importar"
            className="rounded-lg border border-input px-5 py-3 text-base font-medium text-foreground hover:bg-muted"
          >
            Importar planilha
          </Link>
        </div>
      </div>

      <form className="mt-6 rounded-lg bg-card p-6 shadow-sm">
        <label htmlFor="busca" className="block text-sm font-medium text-foreground">
          Buscar por nome ou código de barras
        </label>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <input
            id="busca"
            name="busca"
            defaultValue={termo}
            className="w-full max-w-sm rounded-lg border border-input bg-card px-4 py-3 text-base text-foreground"
          />
          <label className="flex items-center gap-2 text-base text-foreground">
            <input type="checkbox" name="inativos" value="sim" defaultChecked={Boolean(inativos)} className="h-5 w-5" />
            Mostrar inativos
          </label>
          <button
            type="submit"
            className="rounded-lg bg-muted px-5 py-3 text-base font-medium text-foreground hover:bg-border"
          >
            Buscar
          </button>
        </div>
      </form>

      {total > produtos.length ? (
        <p className="mt-4 text-base text-warning">
          Mostrando {produtos.length} de {total}. Refine a busca.
        </p>
      ) : null}

      {produtos.length === 0 ? (
        <p className="mt-6 rounded-lg bg-card p-8 text-lg text-muted-foreground shadow-sm">
          Nenhum produto encontrado.
        </p>
      ) : (
        <table className="mt-6 w-full rounded-lg bg-card text-left text-base shadow-sm">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
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
                <tr key={p.id} className="border-b border-border">
                  <td className="p-4 text-muted-foreground">{p.codigo_barras ?? '—'}</td>
                  <td className="p-4">
                    <Link href={`/produtos/${p.id}`} className="text-foreground underline">
                      {p.nome}
                    </Link>
                    {!p.ativo ? <span className="ml-2 text-sm text-muted-foreground">(inativo)</span> : null}
                  </td>
                  <td className="p-4 text-foreground">{formatarMoeda(p.preco_venda)}</td>
                  <td className={`p-4 font-medium ${zerado ? 'text-muted-foreground' : baixo ? 'text-destructive' : 'text-foreground'}`}>
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
