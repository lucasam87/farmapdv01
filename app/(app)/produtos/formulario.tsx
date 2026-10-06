'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { salvarProduto, type ResultadoAcao } from './actions'

export type ProdutoForm = {
  id: string | null
  codigo_barras: string | null
  nome: string
  categoria: string | null
  unidade: string
  preco_custo: number
  preco_venda: number
  estoque_minimo: number
  ativo: boolean
}

const CAMPO =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-500'
const ROTULO = 'mt-4 block text-sm font-medium text-slate-700'

function reais(centavos: number): string {
  return (centavos / 100).toFixed(2).replace('.', ',')
}

// Sem campo de ESTOQUE de proposito: quem move estoque e a Entrada/Ajuste, e o
// saldo tem que ter sempre um movimento explicando (spec 8.6).
export function FormularioProduto({ produto }: { produto: ProdutoForm | null }) {
  const [estado, acao, enviando] = useActionState<ResultadoAcao | null, FormData>(salvarProduto, null)

  return (
    <form action={acao} className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-800">
        {produto ? 'Editar produto' : 'Novo produto'}
      </h1>

      {estado && !estado.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-base text-red-700">
          {estado.mensagem}
        </p>
      ) : null}

      <input type="hidden" name="produto_id" value={produto?.id ?? ''} />

      <label htmlFor="nome" className={ROTULO}>
        Nome
      </label>
      <input id="nome" name="nome" required defaultValue={produto?.nome ?? ''} className={CAMPO} />

      <label htmlFor="codigo_barras" className={ROTULO}>
        Código de barras
      </label>
      <input
        id="codigo_barras"
        name="codigo_barras"
        defaultValue={produto?.codigo_barras ?? ''}
        className={CAMPO}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="categoria" className={ROTULO}>
            Categoria
          </label>
          <input id="categoria" name="categoria" defaultValue={produto?.categoria ?? ''} className={CAMPO} />
        </div>
        <div>
          <label htmlFor="unidade" className={ROTULO}>
            Unidade
          </label>
          <input id="unidade" name="unidade" defaultValue={produto?.unidade ?? 'un'} className={CAMPO} />
        </div>
        <div>
          <label htmlFor="preco_custo" className={ROTULO}>
            Preço de custo
          </label>
          <input
            id="preco_custo"
            name="preco_custo"
            inputMode="decimal"
            placeholder="0,00"
            required
            defaultValue={produto ? reais(produto.preco_custo) : ''}
            className={CAMPO}
          />
        </div>
        <div>
          <label htmlFor="preco_venda" className={ROTULO}>
            Preço de venda
          </label>
          <input
            id="preco_venda"
            name="preco_venda"
            inputMode="decimal"
            placeholder="0,00"
            required
            defaultValue={produto ? reais(produto.preco_venda) : ''}
            className={CAMPO}
          />
        </div>
      </div>

      <label htmlFor="estoque_minimo" className={ROTULO}>
        Estoque mínimo (para o aviso de estoque baixo)
      </label>
      <input
        id="estoque_minimo"
        name="estoque_minimo"
        inputMode="numeric"
        defaultValue={produto ? String(produto.estoque_minimo) : '0'}
        className={CAMPO}
      />

      <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
        O estoque inicial entra depois, em Entrada de estoque. Este formulário não mexe no saldo.
      </p>

      <label className="mt-4 flex items-center gap-2 text-base text-slate-700">
        <input
          type="checkbox"
          name="ativo"
          value="sim"
          defaultChecked={produto ? produto.ativo : true}
          className="h-5 w-5"
        />
        Produto ativo (aparece na busca do PDV)
      </label>

      <div className="mt-8 flex items-center gap-4">
        <button
          type="submit"
          disabled={enviando}
          className="rounded-lg bg-slate-800 px-6 py-3 text-base font-medium text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {enviando ? 'Salvando…' : 'Salvar'}
        </button>
        <Link href="/produtos" className="text-base text-slate-600 underline">
          Cancelar
        </Link>
      </div>
    </form>
  )
}
