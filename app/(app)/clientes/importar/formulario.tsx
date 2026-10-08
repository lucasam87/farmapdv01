'use client'

import Link from 'next/link'
import { useActionState, useCallback, useState } from 'react'
import { formatarMoeda } from '@/lib/format'
import {
  analisarClientesArquivo,
  confirmarImportacaoClientes,
  type ResultadoAnalise,
  type ResultadoImportacao,
} from './actions'

// A amostra da previa, na mesma ordem em que as linhas sao montadas em actions.ts.
const ROTULO = ['nome', 'telefone', 'CPF', 'limite', 'saldo devedor']

export function FormularioImportacaoClientes() {
  const [analise, acaoAnalisar, analisando] = useActionState<ResultadoAnalise | null, FormData>(
    analisarClientesArquivo,
    null,
  )

  /*
   * Qual previa ja foi confirmada — o proprio JSON que viajou no campo oculto.
   *
   * A importacao pertence a UMA previa: sem esta amarracao, o `ok` de uma
   * importacao antiga bloqueava o botao para sempre e analisar OUTRO arquivo na
   * mesma pagina deixava o Confirmar morto, sem uma palavra de explicacao. Agora o
   * botao (e a tarja de sucesso) valem para a previa que esta na tela.
   */
  const [jsonConfirmado, setJsonConfirmado] = useState<string | null>(null)

  const [importacao, acaoImportar, importando] = useActionState<ResultadoImportacao | null, FormData>(
    // `useCallback`: a acao embrulhada nao pode trocar de identidade a cada
    // render (so depende do setter, que o React mantem estavel).
    useCallback(async (anterior: ResultadoImportacao | null, formData: FormData) => {
      const resultado = await confirmarImportacaoClientes(anterior, formData)
      setJsonConfirmado(resultado.ok ? String(formData.get('linhas') ?? '') : null)
      return resultado
    }, []),
    null,
  )

  const previa = analise?.ok ? analise.previa : null
  const jaImportada = previa !== null && jsonConfirmado === previa.json
  // Divergencia so existe quando ha o que comparar: sem linha de TOTAL no arquivo,
  // nao se afirma que conferiu (nem se acusa).
  const semTotalImpresso = previa !== null && previa.totalImpresso === null
  const somasDivergem = previa !== null && previa.totalImpresso !== null && !previa.somaConferida
  const contagemFalhou = previa !== null && (previa.existentes === null || previa.comSaldoLancado === null)
  const podeConfirmar = previa !== null && previa.faltando.length === 0 && previa.validas > 0 && !jaImportada

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-800">Importar clientes com saldo devedor</h1>
      <p className="mt-1 text-base text-slate-500">
        Nada é gravado até você confirmar. Confira as somas e os clientes antes.
      </p>

      <form action={acaoAnalisar} className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <label htmlFor="arquivo" className="block text-sm font-medium text-slate-700">
          Planilha de clientes (.xlsx) ou CSV do sistema antigo
        </label>
        <input
          id="arquivo"
          name="arquivo"
          type="file"
          accept=".xlsx,.csv"
          required
          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900"
        />

        <label className="mt-4 flex items-center gap-2 text-base text-slate-700">
          <input type="checkbox" name="atualizar" value="sim" defaultChecked className="h-5 w-5" />
          Atualizar clientes que já existem (casados pelo CPF)
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
          {/* Os tres numeros da conferencia. O TOTAL impresso e o lado
              INDEPENDENTE: passou pela aritmetica do sistema antigo. As outras
              duas somas passaram pelo nosso leitor — e a diferenca entre elas sao
              as linhas recusadas (sem CPF, CPF repetido ou dado invalido). */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">TOTAL impresso no arquivo</p>
              <p className="text-2xl font-semibold text-slate-800">
                {previa.totalImpresso === null ? '—' : formatarMoeda(previa.totalImpresso)}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Soma das linhas lidas</p>
              <p className="text-2xl font-semibold text-slate-800">{formatarMoeda(previa.somaLida)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Soma que será gravada</p>
              <p className="text-2xl font-semibold text-slate-800">
                {formatarMoeda(previa.somaGravada)}
              </p>
            </div>
          </div>

          {previa.somaGravada !== previa.somaLida ? (
            <p className="mt-4 text-base text-slate-600">
              Descontando as linhas recusadas (sem CPF, CPF repetido ou dado inválido), a{' '}
              <strong>soma que será gravada</strong> é {formatarMoeda(previa.somaGravada)} — o saldo
              dessas linhas <strong>não entra</strong>.
            </p>
          ) : null}

          {somasDivergem ? (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-base text-red-700">
              As somas não batem: o total impresso no arquivo é{' '}
              {formatarMoeda(previa.totalImpresso ?? 0)} e a soma das linhas lidas é{' '}
              {formatarMoeda(previa.somaLida)}. Confira o separador decimal e as colunas antes de
              importar.
            </p>
          ) : null}

          {previa.somaConferida ? (
            <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-base text-emerald-900">
              A soma das linhas confere com o TOTAL impresso no arquivo.
            </p>
          ) : null}

          {semTotalImpresso ? (
            <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-base text-amber-800">
              O arquivo não tem linha de TOTAL, então não há contra o que conferir a soma. Confira as
              primeiras linhas abaixo antes de confirmar.
            </p>
          ) : null}

          {/* RULING DO CONTROLADOR (T2): `p_atualizar_existentes = false` AINDA
              lanca o saldo. A importacao existe para trazer os saldos; a flag e
              cadastral. Sem esta linha, o dono desmarca esperando que nada
              aconteca com quem ja existe — e o saldo e lancado. */}
          <p className="mt-4 rounded-lg bg-sky-50 px-4 py-3 text-base text-sky-900">
            O saldo devedor é lançado para <strong>todos</strong> os clientes do arquivo, inclusive os
            que já existem: <strong>desmarcar a atualização não impede o lançamento do saldo</strong> —
            a flag é só cadastral (nome, telefone e limite).
          </p>

          <p className="mt-4 text-base text-slate-600">
            <strong>{previa.totalLinhas} linha(s) de cliente</strong> lidas do arquivo · {previa.validas}{' '}
            válida(s) · {previa.invalidas} com erro
          </p>

          {previa.semCpf > 0 ? (
            <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-base text-amber-800">
              <strong>{previa.semCpf} linha(s) sem CPF.</strong> Sem CPF não há como encontrar o
              cliente já cadastrado: essas linhas são recusadas e o saldo delas não é lançado. Corrija
              o CPF no sistema antigo e importe de novo.
            </p>
          ) : null}

          {previa.existentes !== null && previa.existentes > 0 ? (
            <p className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-base text-slate-700">
              {previa.existentes} cliente(s) deste arquivo já estão cadastrados e{' '}
              {previa.atualizar
                ? 'serão atualizados (nome, telefone e limite que vierem na planilha).'
                : 'NÃO serão alterados, porque a atualização está desmarcada — o saldo, mesmo assim, é lançado.'}
            </p>
          ) : null}

          {/* A GUARDA CONTRA DOBRAR A DIVIDA, avisada ANTES de confirmar: a RPC
              ignora o saldo de quem ja tem o lancamento marcado e conta em
              `saldos_ignorados`. O dono precisa ver esse numero aqui. */}
          {previa.comSaldoLancado !== null && previa.comSaldoLancado > 0 ? (
            <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-base text-amber-900">
              <strong>
                {previa.comSaldoLancado} cliente(s) deste arquivo já têm o saldo importado lançado.
              </strong>{' '}
              O saldo deles <strong>será ignorado</strong> (contam como saldos ignorados): reimportar a
              mesma planilha não dobra a dívida.
            </p>
          ) : null}

          {contagemFalhou ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-base text-amber-800">
              Não foi possível conferir quantos clientes deste arquivo já estão cadastrados ou já têm
              saldo lançado — os números acima podem estar incompletos. A guarda contra lançar o saldo
              duas vezes é do banco e continua valendo.
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

          {previa.primeiras.length > 0 ? (
            <div className="mt-6 overflow-x-auto">
              <p className="mb-2 text-sm text-slate-500">
                Amostra: as {previa.primeiras.length} primeiras das {previa.validas} linha(s) que
                serão gravadas (de {previa.totalLinhas} lidas no arquivo). Confira nome, CPF e saldo
                de cada uma:
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
                          {j === 3 || j === 4 ? (
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
            {/* A escolha FEITA na analise, e nao um `sim` fixo: e isso que faz o
                checkbox valer (defeito f120328). */}
            <input type="hidden" name="atualizar" value={previa.atualizar ? 'sim' : 'nao'} />
            <button
              type="submit"
              disabled={!podeConfirmar || importando}
              className="rounded-lg bg-emerald-700 px-6 py-3 text-base font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {importando ? 'Importando…' : 'Confirmar importação'}
            </button>
            {jaImportada ? (
              <p className="mt-2 text-sm text-slate-500">
                Esta prévia já foi importada. Analise outro arquivo para importar mais clientes.
              </p>
            ) : !podeConfirmar ? (
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

      {/* A tarja de sucesso e da previa que foi confirmada: analisar outro arquivo
          esconde o resumo antigo em vez de deixá-lo ao lado de uma previa nova. */}
      {importacao?.ok && jaImportada ? (
        <section className="mt-6 rounded-2xl bg-emerald-50 p-6">
          <p className="text-lg text-emerald-900">
            Clientes: {importacao.resumo.criados} novo(s), {importacao.resumo.atualizados}{' '}
            atualizado(s), {importacao.resumo.ignorados} ignorado(s).
          </p>
          <p className="mt-1 text-lg text-emerald-900">
            Saldos lançados: {importacao.resumo.saldos_lancados}. Saldos ignorados (o cliente já tinha
            o saldo): {importacao.resumo.saldos_ignorados}.
          </p>
          <Link href="/clientes" className="mt-3 inline-block text-base font-medium text-emerald-800 underline">
            Ver clientes
          </Link>
        </section>
      ) : null}
    </div>
  )
}
