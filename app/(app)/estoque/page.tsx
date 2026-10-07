import Link from 'next/link'
import { criarClienteServidor } from '@/lib/supabase/server'
import { formatarData } from '@/lib/format'
import { FormularioEstoque } from '../produtos/formulario-estoque'

// Tres listas que a farmacia olha de verdade: o que esta acabando, o que acabou e
// o que esta parado na prateleira. Todas vem de views que ja existem desde a
// Etapa 2 — esta tela e so leitura mais os formularios de movimento.
//
// A regra do "parado" (decidida na Etapa 2): produto que NUNCA foi vendido conta
// os 60 dias a partir do CADASTRO, senao todo produto novo apareceria parado no
// dia seguinte. A coluna `referencia` da view mostra de onde a conta partiu.

const ABAS = [
  { chave: 'baixo', rotulo: 'Estoque baixo' },
  { chave: 'zerado', rotulo: 'Zerado ou negativo' },
  { chave: 'parado', rotulo: 'Parado há 60 dias' },
] as const

type Aba = (typeof ABAS)[number]['chave']

type ItemEstoque = {
  produto_id: string
  nome: string
  estoque_atual: number
  estoque_minimo?: number
  ultima_venda?: string | null
  referencia?: string | null
}

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>
}) {
  const { aba } = await searchParams
  const ativa: Aba = ABAS.some((a) => a.chave === aba) ? (aba as Aba) : 'baixo'

  const supabase = await criarClienteServidor()

  const view =
    ativa === 'baixo' ? 'v_estoque_baixo' : ativa === 'zerado' ? 'v_estoque_zerado' : 'v_estoque_parado'
  const campos =
    ativa === 'baixo'
      ? 'produto_id, nome, estoque_atual, estoque_minimo'
      : ativa === 'zerado'
        ? 'produto_id, nome, estoque_atual'
        : 'produto_id, nome, estoque_atual, ultima_venda, referencia'

  const { data } = await supabase.from(view).select(campos).limit(50)
  const itens = (data ?? []) as unknown as ItemEstoque[]

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-800">Estoque</h1>

      <nav className="mt-4 flex flex-wrap gap-2">
        {ABAS.map((a) => (
          <Link
            key={a.chave}
            href={`/estoque?aba=${a.chave}`}
            className={
              a.chave === ativa
                ? 'rounded-lg bg-slate-800 px-5 py-3 text-base font-medium text-white'
                : 'rounded-lg border border-slate-300 px-5 py-3 text-base font-medium text-slate-700 hover:bg-slate-100'
            }
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>

      {ativa === 'parado' ? (
        <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Produto que nunca foi vendido conta os 60 dias a partir do cadastro. A data de referência
          aparece na última coluna.
        </p>
      ) : null}

      {itens.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-white p-8 text-lg text-slate-600 shadow-sm">
          Nada nesta lista.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {itens.map((item) => (
            <li key={item.produto_id} className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link href={`/produtos/${item.produto_id}`} className="text-lg text-slate-800 underline">
                    {item.nome}
                  </Link>
                  <p className="mt-1 text-base text-slate-600">
                    Estoque atual: <span className="font-semibold text-slate-800">{item.estoque_atual}</span>
                    {item.estoque_minimo !== undefined ? <> · mínimo {item.estoque_minimo}</> : null}
                    {ativa === 'parado' ? (
                      <>
                        {' '}
                        · última venda:{' '}
                        {item.ultima_venda ? formatarData(item.ultima_venda) : 'nunca vendido'} · referência:{' '}
                        {item.referencia ? formatarData(item.referencia) : '—'}
                      </>
                    ) : null}
                  </p>
                </div>
              </div>

              <details className="mt-4">
                <summary className="cursor-pointer text-base font-medium text-slate-700">
                  Entrada ou ajuste
                </summary>
                <div className="mt-4">
                  <FormularioEstoque produtoId={item.produto_id} compacto />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
