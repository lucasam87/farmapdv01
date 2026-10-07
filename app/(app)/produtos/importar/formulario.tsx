'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { formatarMoeda } from '@/lib/format'
import {
  analisarArquivo,
  confirmarImportacao,
  type ResultadoAnalise,
  type ResultadoImportacao,
} from './actions'

const ROTULO = [
  'codigo_barras',
  'nome',
  'categoria',
  'unidade',
  'preco_custo',
  'preco_venda',
  'estoque_atual',
  'estoque_minimo',
]

export function FormularioImportacao() {
  const [analise, acaoAnalisar, analisando] = useActionState<ResultadoAnalise | null, FormData>(
    analisarArquivo,
    null,
  )
  const [importacao, acaoImportar, importando] = useActionState<ResultadoImportacao | null, FormData>(
    confirmarImportacao,
    null,
  )

  const previa = analise?.ok ? analise.previa : null
  // Divergencia so existe quando ha o que comparar: sem linha de TOTAL no
  // arquivo, nao se afirma que conferiu (nem se acusa).
  const semTotalImpresso = previa !== null && previa.totalImpresso === null
  const somasDivergem = previa !== null && previa.totalImpresso !== null && !previa.somaConferida
  const podeConfirmar =
    previa !== null && previa.faltando.length === 0 && previa.validas > 0 && importacao?.ok !== true

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-800">Importar planilha</h1>
      <p className="mt-1 text-base text-slate-500">
        Nada é gravado até você confirmar. Confira as duas somas antes.
      </p>

      <form action={acaoAnalisar} className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <label htmlFor="arquivo" className="block text-sm font-medium text-slate-700">
          Planilha, CSV ou PDF do sistema antigo
        </label>
        <input
          id="arquivo"
          name="arquivo"
          type="file"
          accept=".xlsx,.csv,.pdf"
          required
          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900"
        />

        <label className="mt-4 flex items-center gap-2 text-base text-slate-700">
          <input type="checkbox" name="atualizar" value="sim" defaultChecked className="h-5 w-5" />
          Atualizar produtos que já existem (casados pelo código de barras)
        </label>

        <button
          type="submit"
          disabled={analisando}
          className="mt-6 rounded-lg bg-slate-800 px-6 py-3 text-base font-medium text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {analisando ? 'Lendo o arquivo…' : 'Analisar arquivo'}
        </button>
      </form>

      {analise && !analise.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-base text-red-700">
          {analise.mensagem}
        </p>
      ) : null}

      {previa ? (
        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
          {/* Os dois lados da conferencia sao INDEPENDENTES: o total que o
              sistema antigo imprimiu no arquivo contra a soma que o nosso leitor
              vai gravar. E essa comparacao que pega coluna trocada e linha
              perdida (spec 8.7). */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Total impresso na planilha</p>
              <p className="text-2xl font-semibold text-slate-800">
                {previa.totalImpresso === null ? '—' : formatarMoeda(previa.totalImpresso)}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Soma que será gravada</p>
              <p className="text-2xl font-semibold text-slate-800">
                {formatarMoeda(previa.somaGravada)}
              </p>
            </div>
          </div>

          {somasDivergem ? (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-base text-red-700">
              As somas não batem: o total impresso no arquivo é{' '}
              {formatarMoeda(previa.totalImpresso ?? 0)} e a soma das linhas lidas é{' '}
              {formatarMoeda(previa.somaGravada)}. Confira o separador decimal e as colunas antes
              de importar.
            </p>
          ) : null}

          {previa.somaConferida ? (
            <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-base text-emerald-900">
              A soma das linhas confere com o total impresso no arquivo.
            </p>
          ) : null}

          {!previa.colunasPresentes.preco_venda ? (
            <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-base text-amber-800">
              Esta planilha não trouxe a coluna de preço de venda
              {!previa.colunasPresentes.preco_custo ? ' nem a de preço de custo' : ''}. Os produtos
              que já existem <strong>não terão o preço alterado</strong>; os novos entram com preço
              zero e precisam ser completados depois.
            </p>
          ) : null}

          {semTotalImpresso ? (
            <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-base text-amber-800">
              O arquivo não tem linha de TOTAL, então não há contra o que conferir a soma. Confira
              as primeiras linhas abaixo antes de confirmar.
            </p>
          ) : null}

          <p className="mt-4 text-base text-slate-600">
            <strong>{previa.totalLinhas} linha(s) de produto</strong> lidas do arquivo ·{' '}
            {previa.validas} válida(s) · {previa.invalidas} com erro · {previa.descartadas} de
            total ignorada(s)
          </p>

          {previa.existentes > 0 ? (
            <p className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-base text-slate-700">
              {previa.existentes} produto(s) deste arquivo já existem no catálogo e{' '}
              {previa.atualizar
                ? 'serão atualizados (nome, categoria, unidade e os preços que vierem na planilha).'
                : 'NÃO serão alterados, porque a atualização está desmarcada.'}
            </p>
          ) : null}

          {previa.avisos.map((aviso) => (
            <p key={aviso} className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {aviso}
            </p>
          ))}

          {previa.faltando.length > 0 ? (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-base text-red-700">
              Não encontrei a coluna obrigatória: {previa.faltando.join(', ')}.
            </p>
          ) : null}

          {/* A RPC recusa a importacao INTEIRA por um codigo repetido, e o
              catalogo real do sistema antigo tem varios. Melhor avisar aqui do
              que o dono descobrir na recusa, depois de conferir a amostra. */}
          {previa.codigosRepetidos.length > 0 ? (
            <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-base text-amber-800">
              <strong>
                {previa.codigosRepetidos.length} código(s) de barras aparecem mais de uma vez no
                arquivo.
              </strong>{' '}
              Importando o <strong>primeiro cadastro</strong> de cada um e ignorando{' '}
              {previa.ignoradasPorRepeticao} linha(s) — a segunda sobrescreveria a primeira em
              silêncio. Corrija no sistema antigo quando puder. Repetido(s):{' '}
              {previa.codigosRepetidos.slice(0, 5).join(', ')}
              {previa.codigosRepetidos.length > 5
                ? ` … e mais ${previa.codigosRepetidos.length - 5}.`
                : '.'}
            </p>
          ) : null}

          {previa.primeiras.length > 0 ? (
            <div className="mt-6 overflow-x-auto">
              <p className="mb-2 text-sm text-slate-500">
                Amostra: as {previa.primeiras.length} primeiras linhas de {previa.totalLinhas} que
                serão gravadas. Confira nome e preço de cada uma:
              </p>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    {ROTULO.map((c) => (
                      <th key={c} className="py-2 pr-4 font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previa.primeiras.map((linha, i) => (
                    <tr key={i} className="border-b border-slate-100 text-slate-700">
                      {linha.map((valor, j) => (
                        <td key={j} className="py-2 pr-4">
                          {j === 4 || j === 5 ? (
                            <span className="whitespace-nowrap">{valor}</span>
                          ) : (
                            valor
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {previa.erros.length > 0 ? (
            <div className="mt-6">
              <p className="text-sm font-medium text-slate-700">Linhas com problema</p>
              <ul className="mt-2 space-y-1 text-sm text-red-700">
                {previa.erros.slice(0, 20).map((e) => (
                  <li key={e.linha}>
                    Linha {e.linha}: {e.erros.join(' ')}
                  </li>
                ))}
              </ul>
              {previa.erros.length > 20 ? (
                <p className="mt-2 text-sm text-slate-500">
                  … e mais {previa.erros.length - 20} linha(s) com problema.
                </p>
              ) : null}
            </div>
          ) : null}

          <form action={acaoImportar} className="mt-6 border-t border-slate-200 pt-6">
            {/* O arquivo NAO volta ao cliente: viaja so o JSON ja validado. */}
            <input type="hidden" name="linhas" value={previa.json} />
            {/* A escolha FEITA na analise, e nao um `sim` fixo: era isso que
                tornava o checkbox inerte. */}
            <input type="hidden" name="atualizar" value={previa.atualizar ? 'sim' : 'nao'} />
            <button
              type="submit"
              disabled={!podeConfirmar || importando}
              className="rounded-lg bg-emerald-700 px-6 py-3 text-base font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {importando ? 'Importando…' : 'Confirmar importação'}
            </button>
            {!podeConfirmar && importacao?.ok !== true ? (
              <p className="mt-2 text-sm text-slate-500">
                {previa.faltando.length > 0 || previa.validas === 0
                  ? 'Nada para importar: corrija a planilha e analise de novo.'
                  : ''}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}

      {importacao && !importacao.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-base text-red-700">
          {importacao.mensagem}
        </p>
      ) : null}

      {importacao?.ok ? (
        <section className="mt-6 rounded-2xl bg-emerald-50 p-6">
          <p className="text-lg text-emerald-900">
            Importados: {importacao.resumo.criados} novo(s), {importacao.resumo.atualizados}{' '}
            atualizado(s), {importacao.resumo.ignorados} ignorado(s).
          </p>
          <Link href="/produtos" className="mt-3 inline-block text-base font-medium text-emerald-800 underline">
            Ver produtos
          </Link>
        </section>
      ) : null}
    </div>
  )
}
