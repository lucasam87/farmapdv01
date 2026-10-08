import Link from 'next/link'
import { criarClienteServidor } from '@/lib/supabase/server'
import { formatarMoeda } from '@/lib/format'
import { filtroDeBuscaDeCliente } from '@/lib/postgrest'
import { formatarTelefone } from './validacao'

// Lista enxuta, uma tarefa por tela (spec 10), igual a de produtos: o teto existe
// porque a base de clientes vem inteira do sistema antigo (Task 6) e trazer todos
// travaria o balcao. Quem procura alguem usa a busca — que casa nome, telefone e
// CPF.
//
// O SALDO NAO E CONTA DESTA TELA: ele vem de `v_clientes_devedores`, a mesma view
// que o crediario usa, com UMA consulta para os ids da pagina. Recalcular
// "compra − pagamento" aqui seria uma segunda definicao de divida para divergir da
// primeira.

const LIMITE = 50

type Cliente = {
  id: string
  nome: string
  telefone: string | null
  cpf: string | null
  limite_credito: number
  bloqueado: boolean
}

export default async function ClientesPage({
  searchParams,
}: {
  // `string[]` e possivel: `?busca=a&busca=b` chega assim, e `trim` nao existe em
  // array — sem a guarda abaixo a rota estoura (500) por causa da URL.
  searchParams: Promise<{ busca?: string | string[] }>
}) {
  const { busca } = await searchParams
  const supabase = await criarClienteServidor()
  const termo = (Array.isArray(busca) ? (busca[0] ?? '') : (busca ?? '')).trim()

  let consulta = supabase
    .from('clientes')
    .select('id, nome, telefone, cpf, limite_credito, bloqueado', { count: 'exact' })
    .order('nome')
    .limit(LIMITE)

  if (termo !== '') {
    // O termo vai escapado pelo helper (o `or()` concatena a string do filtro), e
    // as clausulas de telefone/CPF so entram quando ha digito no termo — ver
    // lib/postgrest.ts.
    consulta = consulta.or(filtroDeBuscaDeCliente(termo))
  }

  const { data, count } = await consulta
  const clientes = (data ?? []) as Cliente[]
  const total = count ?? clientes.length

  // Uma consulta para a pagina inteira, casada por `cliente_id` aqui no servidor.
  // A view so devolve quem deve; quem nao aparece tem saldo zero.
  const saldos = new Map<string, number>()
  const ids = clientes.map((c) => c.id)
  if (ids.length > 0) {
    const { data: devedores } = await supabase
      .from('v_clientes_devedores')
      .select('cliente_id, saldo')
      .in('cliente_id', ids)
    for (const d of (devedores ?? []) as { cliente_id: string; saldo: number }[]) {
      saldos.set(d.cliente_id, d.saldo)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-800">Clientes</h1>
        <Link
          href="/clientes/novo"
          className="rounded-lg bg-slate-800 px-5 py-3 text-base font-medium text-white hover:bg-slate-700"
        >
          Novo cliente
        </Link>
      </div>

      <form className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <label htmlFor="busca" className="block text-sm font-medium text-slate-700">
          Buscar por nome, telefone ou CPF
        </label>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <input
            id="busca"
            name="busca"
            data-testid="busca-cliente"
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

      {total > clientes.length ? (
        <p className="mt-4 text-base text-amber-800">
          Mostrando {clientes.length} de {total}. Refine a busca.
        </p>
      ) : null}

      {clientes.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-white p-8 text-lg text-slate-600 shadow-sm">
          Nenhum cliente encontrado.
        </p>
      ) : (
        <table className="mt-6 w-full rounded-2xl bg-white text-left text-base shadow-sm">
          <thead>
            <tr className="border-b border-slate-200 text-sm text-slate-500">
              <th className="p-4 font-medium">Nome</th>
              <th className="p-4 font-medium">Telefone</th>
              <th className="p-4 font-medium">CPF</th>
              <th className="p-4 font-medium">Limite</th>
              <th className="p-4 font-medium">Saldo devedor</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => {
              const saldo = saldos.get(c.id) ?? 0
              const telefone = formatarTelefone(c.telefone ?? '')
              return (
                <tr key={c.id} data-testid="linha-cliente" className="border-b border-slate-100">
                  <td className="p-4">
                    <Link href={`/clientes/${c.id}`} className="text-slate-800 underline">
                      {c.nome}
                    </Link>
                    {c.bloqueado ? (
                      <span className="ml-2 text-sm text-red-700">(bloqueado)</span>
                    ) : null}
                  </td>
                  <td className="p-4 text-slate-600">{telefone ?? '—'}</td>
                  <td className="p-4 text-slate-600">{c.cpf ?? '—'}</td>
                  <td className="p-4 text-slate-600">
                    {c.limite_credito > 0 ? formatarMoeda(c.limite_credito) : 'sem crediário'}
                  </td>
                  <td
                    data-testid="saldo-cliente"
                    className={`p-4 font-medium ${saldo > 0 ? 'text-red-700' : 'text-slate-400'}`}
                  >
                    {formatarMoeda(saldo)}
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
