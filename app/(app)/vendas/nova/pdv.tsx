'use client'

import { useEffect, useRef, useState } from 'react'
import { formatarMoeda } from '@/lib/format'
import { finalizarVenda, type VendaRegistrada } from './actions'
import {
  FORMAS,
  adicionarItem,
  calcularFalta,
  calcularTotal,
  calcularTroco,
  lerDesconto,
  type FormaPagamento,
  type ItemCarrinho,
  type Pagamento,
} from './pagamento'

type ProdutoBusca = {
  id: string
  codigo_barras: string | null
  nome: string
  preco_venda: number
  estoque_atual: number
}

type Cliente = { id: string; nome: string; limite_credito: number; saldo: number }

const CAMPO =
  'rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-500'

/**
 * O PDV. Regras que ele respeita:
 *   - so com teclado (spec 10): busca focada, setas escolhem, Enter adiciona,
 *     F6..F10 escolhem a forma e F2 finaliza;
 *   - a chave de idempotencia NASCE com o carrinho e so e trocada depois de uma
 *     venda confirmada — e isso que faz clique/tecla dupla devolver a mesma
 *     venda em vez de criar duas (spec 8.1 passo 1);
 *   - o total mostrado e so para o atendente: quem decide e o banco.
 */
export function Pdv({ clientes }: { clientes: Cliente[] }) {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<ProdutoBusca[]>([])
  const [destaque, setDestaque] = useState(0)
  const [itens, setItens] = useState<ItemCarrinho[]>([])
  const [clienteId, setClienteId] = useState('')
  const [descontoTexto, setDescontoTexto] = useState('')
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([])
  const [formaAtual, setFormaAtual] = useState<FormaPagamento>('dinheiro')
  const [valorTexto, setValorTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [confirmacao, setConfirmacao] = useState<VendaRegistrada | null>(null)
  const [enviando, setEnviando] = useState(false)
  // A chave nasce UMA vez, na inicializacao preguicosa do estado: o valor nunca
  // e renderizado, entao nao existe risco de divergencia de hidratacao. Nascer
  // dentro de um useEffect era um setState sincrono no efeito (lint
  // react-hooks/set-state-in-effect) sem necessidade.
  // Trocar de carrinho NAO troca a chave; so uma venda concluida troca.
  const [chave, setChave] = useState(() => crypto.randomUUID())

  const buscaRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    buscaRef.current?.focus()
  }, [])

  // Busca com espera curta: o leitor de codigo de barras digita rapido e manda
  // Enter, entao a espera nao pode atrapalhar.
  //
  // O termo curto NAO limpa a lista daqui: quem limpa e o onChange do campo. Um
  // setState sincrono no corpo do efeito dispara render em cascata e o lint
  // recusa (react-hooks/set-state-in-effect) — e o evento que mudou o termo ja e
  // o lugar certo para reagir a isso.
  useEffect(() => {
    const alvo = termo.trim()
    if (alvo.length < 2) return
    const controle = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const resposta = await fetch(`/api/produtos/busca?termo=${encodeURIComponent(alvo)}`, {
          signal: controle.signal,
        })
        if (!resposta.ok) return
        const dados = (await resposta.json()) as { produtos: ProdutoBusca[] }
        setResultados(dados.produtos ?? [])
        setDestaque(0)
      } catch {
        // Abortar por nova digitacao nao e erro.
      }
    }, 150)
    return () => {
      clearTimeout(timer)
      controle.abort()
    }
  }, [termo])

  const subtotal = itens.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0)
  const desconto = lerDesconto(descontoTexto, subtotal) ?? 0
  const total = calcularTotal(itens, desconto)
  const falta = calcularFalta(total, pagamentos)
  const troco = calcularTroco(total, pagamentos)

  function adicionar(produto: ProdutoBusca) {
    setItens((atual) =>
      adicionarItem(atual, {
        produto_id: produto.id,
        nome: produto.nome,
        preco_unitario: produto.preco_venda,
        quantidade: 1,
      }),
    )
    setTermo('')
    setResultados([])
    buscaRef.current?.focus()
  }

  function escolherForma(forma: FormaPagamento) {
    setFormaAtual(forma)
    // O valor ja digitado vale para a forma escolhida: o atendente digita o
    // valor e aperta F6/F7/... sem perder o que digitou.
  }

  function adicionarPagamento() {
    const centavos = Number(valorTexto.replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(centavos) || centavos <= 0) {
      setErro('Valor de pagamento inválido.')
      return
    }
    setErro(null)
    setPagamentos((atual) => [...atual, { forma: formaAtual, valor: Math.round(centavos * 100) }])
    setValorTexto('')
  }

  function limpar() {
    setItens([])
    setPagamentos([])
    setClienteId('')
    setDescontoTexto('')
    setValorTexto('')
    setErro(null)
    setTermo('')
    setResultados([])
    buscaRef.current?.focus()
  }

  async function finalizar() {
    if (enviando) return
    setErro(null)

    if (itens.length === 0) {
      setErro('Carrinho vazio.')
      return
    }
    if (pagamentos.length === 0) {
      setErro('Informe a forma de pagamento.')
      return
    }
    if (falta > 0) {
      setErro(`Faltam ${formatarMoeda(falta)} para fechar a venda.`)
      return
    }

    setEnviando(true)
    const resultado = await finalizarVenda({
      chave,
      cliente_id: clienteId === '' ? null : clienteId,
      itens: itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade })),
      pagamentos,
      desconto,
    })
    setEnviando(false)

    if (!resultado.ok) {
      setErro(resultado.mensagem)
      return
    }

    // Venda fechada: agora sim o carrinho e a chave viram novos.
    setConfirmacao(resultado.venda)
    setItens([])
    setPagamentos([])
    setClienteId('')
    setDescontoTexto('')
    setValorTexto('')
    setChave(crypto.randomUUID())
    buscaRef.current?.focus()
  }

  function teclaBusca(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault()
      setDestaque((d) => Math.min(d + 1, Math.max(0, resultados.length - 1)))
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault()
      setDestaque((d) => Math.max(0, d - 1))
    } else if (evento.key === 'Enter') {
      evento.preventDefault()
      if (resultados[destaque]) adicionar(resultados[destaque])
    } else if (evento.key === 'Escape') {
      setResultados([])
    }
  }

  // Atalhos das formas e do finalizar, no formulario inteiro.
  function teclaFormulario(evento: React.KeyboardEvent<HTMLFormElement>) {
    const atalho = FORMAS.find((f) => f.tecla === evento.key)
    if (atalho) {
      evento.preventDefault()
      escolherForma(atalho.forma)
      return
    }
    if (evento.key === 'F2') {
      evento.preventDefault()
      void finalizar()
    }
  }

  return (
    <form
      onKeyDown={teclaFormulario}
      onSubmit={(e) => e.preventDefault()}
      className="mx-auto max-w-5xl"
      data-testid="pdv"
    >
      <input
        ref={buscaRef}
        value={termo}
        onChange={(e) => {
          setTermo(e.target.value)
          // Termo curto demais para buscar: some com a lista aqui, e nao dentro
          // do efeito (ver o comentario do efeito de busca).
          if (e.target.value.trim().length < 2) setResultados([])
        }}
        onKeyDown={teclaBusca}
        placeholder="Bipe o código de barras ou digite o nome"
        aria-label="Buscar produto"
        className={`${CAMPO} w-full text-lg`}
      />

      {resultados.length > 0 ? (
        <ul className="mt-1 rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="resultados">
          {resultados.map((p, i) => (
            <li
              key={p.id}
              className={`cursor-pointer px-4 py-3 text-base ${i === destaque ? 'bg-slate-100' : ''}`}
              onMouseEnter={() => setDestaque(i)}
              onClick={() => adicionar(p)}
            >
              <span className="font-medium text-slate-800">{p.nome}</span>
              <span className="ml-3 text-slate-500">{formatarMoeda(p.preco_venda)}</span>
              <span className="ml-3 text-sm text-slate-400">estoque {p.estoque_atual}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {confirmacao ? (
        <p
          data-testid="confirmacao"
          className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-base text-emerald-900"
        >
          Venda {confirmacao.numero} registrada. Total {formatarMoeda(confirmacao.total)}
          {confirmacao.troco > 0 ? ` · Troco ${formatarMoeda(confirmacao.troco)}` : ''}.
        </p>
      ) : null}

      <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm" data-testid="carrinho">
        {itens.length === 0 ? (
          <p className="text-base text-slate-500">Carrinho vazio. Bipe ou busque um produto.</p>
        ) : (
          <table className="w-full text-left text-base">
            <thead>
              <tr className="border-b border-slate-200 text-sm text-slate-500">
                <th className="py-2 pr-4 font-medium">Produto</th>
                <th className="py-2 pr-4 font-medium">Qtd</th>
                <th className="py-2 pr-4 font-medium">Preço</th>
                <th className="py-2 pr-4 font-medium">Subtotal</th>
                <th className="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.produto_id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 text-slate-800">{item.nome}</td>
                  <td className="py-2 pr-4">
                    <button
                      type="button"
                      aria-label={`Diminuir ${item.nome}`}
                      onClick={() =>
                        setItens((atual) =>
                          atual
                            .map((i) =>
                              i.produto_id === item.produto_id ? { ...i, quantidade: i.quantidade - 1 } : i,
                            )
                            .filter((i) => i.quantidade > 0),
                        )
                      }
                      className="mr-2 rounded border border-slate-300 px-2"
                    >
                      −
                    </button>
                    {item.quantidade}
                    <button
                      type="button"
                      aria-label={`Aumentar ${item.nome}`}
                      onClick={() =>
                        setItens((atual) =>
                          atual.map((i) =>
                            i.produto_id === item.produto_id ? { ...i, quantidade: i.quantidade + 1 } : i,
                          ),
                        )
                      }
                      className="ml-2 rounded border border-slate-300 px-2"
                    >
                      +
                    </button>
                  </td>
                  <td className="py-2 pr-4 text-slate-700">{formatarMoeda(item.preco_unitario)}</td>
                  <td className="py-2 pr-4 text-slate-700">
                    {formatarMoeda(item.preco_unitario * item.quantidade)}
                  </td>
                  <td className="py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => setItens((atual) => atual.filter((i) => i.produto_id !== item.produto_id))}
                      className="text-sm text-slate-500 underline"
                    >
                      remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="mt-6 text-4xl font-semibold text-slate-800" data-testid="total">
          {formatarMoeda(total)}
        </p>
        {falta > 0 ? (
          <p className="mt-1 text-base text-slate-500" data-testid="falta">
            Falta {formatarMoeda(falta)}
          </p>
        ) : null}
        {troco > 0 ? <p className="mt-1 text-base text-emerald-700">Troco {formatarMoeda(troco)}</p> : null}
      </section>

      <section className="mt-4 grid gap-4 rounded-2xl bg-white p-6 shadow-sm sm:grid-cols-2">
        <div>
          <label htmlFor="desconto" className="block text-sm font-medium text-slate-700">
            Desconto (5 ou 5%)
          </label>
          <input
            id="desconto"
            value={descontoTexto}
            onChange={(e) => setDescontoTexto(e.target.value)}
            className={`${CAMPO} mt-1 w-full`}
          />

          <label htmlFor="cliente" className="mt-4 block text-sm font-medium text-slate-700">
            Cliente (obrigatório no crediário)
          </label>
          <select
            id="cliente"
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value)}
            className={`${CAMPO} mt-1 w-full`}
          >
            <option value="">Sem cliente</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
                {c.limite_credito > 0 ? ` — deve ${formatarMoeda(c.saldo)} de ${formatarMoeda(c.limite_credito)}` : ' — sem crediário'}
              </option>
            ))}
          </select>
        </div>

        <div>
          <p className="text-sm font-medium text-slate-700">Pagamento</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {FORMAS.map((f) => (
              <button
                key={f.forma}
                type="button"
                onClick={() => escolherForma(f.forma)}
                className={
                  f.forma === formaAtual
                    ? 'rounded-lg bg-slate-800 px-3 py-2 text-sm text-white'
                    : 'rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700'
                }
              >
                {f.rotulo} <span className="text-xs opacity-70">{f.tecla}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={valorTexto}
              onChange={(e) => setValorTexto(e.target.value)}
              placeholder="0,00"
              inputMode="decimal"
              aria-label="Valor do pagamento"
              className={`${CAMPO} w-32`}
            />
            <button
              type="button"
              onClick={adicionarPagamento}
              className="rounded-lg border border-slate-300 px-4 py-3 text-base text-slate-700"
            >
              Lançar
            </button>
          </div>

          {pagamentos.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-slate-600">
              {pagamentos.map((p, i) => (
                <li key={i}>
                  {p.forma}: {formatarMoeda(p.valor)}{' '}
                  <button
                    type="button"
                    onClick={() => setPagamentos((atual) => atual.filter((_, j) => j !== i))}
                    className="underline"
                  >
                    remover
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      {erro ? (
        <p
          role="alert"
          data-testid="erro"
          className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-base text-red-700"
        >
          {erro}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => void finalizar()}
          disabled={enviando}
          className="rounded-lg bg-emerald-700 px-8 py-4 text-lg font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
        >
          {enviando ? 'Finalizando…' : 'Finalizar (F2)'}
        </button>
        <button
          type="button"
          onClick={limpar}
          className="rounded-lg border border-slate-300 px-6 py-4 text-base text-slate-700"
        >
          Limpar (Esc)
        </button>
      </div>
    </form>
  )
}
