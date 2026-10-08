import Link from 'next/link'
import { notFound } from 'next/navigation'
import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'
import { formatarMoeda, formatarDataHora } from '@/lib/format'
import { FormularioCliente } from '../formulario'
import { Receber } from '../../crediario/receber'
import { formatarTelefone, linkWhatsApp } from '../validacao'

// Detalhe do cliente: dados, saldo devedor, extrato do crediario, recebimento e o
// link do WhatsApp.
//
// O SALDO VEM DA VIEW. `compra − pagamento` e uma conta que ja existe em
// `v_clientes_devedores` (a mesma que o crediario e o PDV leem); refazer a soma
// aqui seria uma segunda definicao de divida, livre para divergir da primeira.
// A view so devolve quem deve: quem nao aparece deve zero.

type Cliente = {
  id: string
  nome: string
  telefone: string | null
  cpf: string | null
  limite_credito: number
  bloqueado: boolean
  observacao: string | null
}

type Lancamento = {
  id: string
  tipo: string
  valor: number
  forma_pagamento: string | null
  observacao: string | null
  criado_em: string
}

const ROTULO_DO_LANCAMENTO: Record<string, string> = {
  compra: 'Compra',
  pagamento: 'Pagamento',
}

const ROTULO_DA_FORMA: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  debito: 'Débito',
  credito: 'Crédito',
}

export default async function ClientePage({
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
    .from('clientes')
    .select('id, nome, telefone, cpf, limite_credito, bloqueado, observacao')
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()
  const cliente = data as Cliente

  // O papel so importa para o formulario; ler o perfil no detalhe (que so mostra)
  // seria uma ida ao banco por nada.
  if (editar) {
    const perfil = await perfilAtual()
    return <FormularioCliente cliente={cliente} ehDono={perfil?.papel === 'dono'} />
  }

  const { data: devedor } = await supabase
    .from('v_clientes_devedores')
    .select('saldo')
    .eq('cliente_id', id)
    .maybeSingle()
  const saldo = devedor ? (devedor.saldo as number) : 0

  // Mais recente primeiro, teto de 50 — o extrato e para conferir o que acabou de
  // acontecer no balcao, nao para auditar anos de movimento (relatorios, Etapa 8).
  const { data: lancamentos } = await supabase
    .from('crediario_lancamentos')
    .select('id, tipo, valor, forma_pagamento, observacao, criado_em')
    .eq('cliente_id', id)
    .order('criado_em', { ascending: false })
    .limit(50)

  const telefone = formatarTelefone(cliente.telefone ?? '')
  // O link SO abre o WhatsApp com a mensagem pronta — nada e enviado daqui
  // (spec 8.4). Sem telefone nao ha link, e a tela diz isso.
  const link = linkWhatsApp(cliente.telefone, cliente.nome, saldo)

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/clientes" className="text-base text-slate-600 underline">
        ← Clientes
      </Link>

      <div className="mt-4 rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">{cliente.nome}</h1>
            <p className="mt-1 text-base text-slate-500">
              {/* Telefone torto (nem 10 nem 11 digitos) nao ganha mascara, mas
                  tambem nao some: e o numero que esta gravado, e e o que o
                  `linkWhatsApp` usa se houver digito. */}
              {telefone ?? cliente.telefone ?? 'sem telefone'} · {cliente.cpf ?? 'sem CPF'}
            </p>
          </div>
          <Link
            href={`/clientes/${cliente.id}?editar=1`}
            className="rounded-lg border border-slate-300 px-5 py-3 text-base font-medium text-slate-700 hover:bg-slate-100"
          >
            Editar
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">Saldo devedor</p>
            <p
              data-testid="saldo-cliente"
              className={`text-4xl font-semibold ${saldo > 0 ? 'text-red-700' : 'text-slate-400'}`}
            >
              {formatarMoeda(saldo)}
            </p>
          </div>
          <p className="text-base text-slate-500">
            Limite de crédito:{' '}
            {cliente.limite_credito > 0 ? formatarMoeda(cliente.limite_credito) : 'não faz crediário'}
          </p>
        </div>

        {cliente.bloqueado ? (
          <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-base text-amber-800">
            Cliente bloqueado: o PDV recusa crediário para ele.
          </p>
        ) : null}

        {cliente.observacao ? (
          <p className="mt-4 whitespace-pre-line text-base text-slate-600">{cliente.observacao}</p>
        ) : null}
      </div>

      <section className="mt-6 rounded-2xl bg-white p-8 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-800">Receber pagamento</h2>
        <p className="mt-1 text-base text-slate-500">
          Dinheiro entra no caixa; PIX e cartão baixam a dívida sem mexer no esperado da gaveta.
        </p>
        {/* O formulario aparece mesmo com o saldo zerado: a recusa da divida ja
            zerada e a mensagem da RPC (nunca gera credito, spec 8.4), e esconder o
            campo faria o operador procurar em outra tela o motivo de nao receber. */}
        <div className="mt-4">
          <Receber clienteId={cliente.id} nome={cliente.nome} saldo={saldo} />
        </div>

        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block rounded-lg border border-emerald-700 px-5 py-3 text-base font-medium text-emerald-800 hover:bg-emerald-50"
          >
            Cobrar {cliente.nome} no WhatsApp
          </a>
        ) : (
          <p className="mt-4 text-base text-slate-500">Cliente sem telefone cadastrado.</p>
        )}
        {link ? (
          <p className="mt-2 text-sm text-slate-500">
            O sistema só abre o WhatsApp com a mensagem pronta: quem envia é você.
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-2xl bg-white p-8 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-800">Extrato do crediário</h2>
        {(lancamentos ?? []).length === 0 ? (
          <p className="mt-4 text-base text-slate-500">
            Nenhum lançamento ainda. A dívida nasce na venda no crediário ou no saldo inicial.
          </p>
        ) : (
          <table className="mt-4 w-full text-left text-base">
            <thead>
              <tr className="border-b border-slate-200 text-sm text-slate-500">
                <th className="py-2 pr-4 font-medium">Quando</th>
                <th className="py-2 pr-4 font-medium">Tipo</th>
                <th className="py-2 pr-4 font-medium">Valor</th>
                <th className="py-2 pr-4 font-medium">Forma</th>
                <th className="py-2 pr-4 font-medium">Observação</th>
              </tr>
            </thead>
            <tbody>
              {(lancamentos as Lancamento[]).map((l) => (
                <tr key={l.id} className="border-b border-slate-100 text-slate-700">
                  <td className="py-2 pr-4">{formatarDataHora(l.criado_em)}</td>
                  <td className="py-2 pr-4">{ROTULO_DO_LANCAMENTO[l.tipo] ?? l.tipo}</td>
                  <td
                    className={`py-2 pr-4 font-medium ${
                      l.tipo === 'pagamento' ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {l.tipo === 'pagamento' ? `- ${formatarMoeda(l.valor)}` : formatarMoeda(l.valor)}
                  </td>
                  <td className="py-2 pr-4">
                    {l.forma_pagamento
                      ? (ROTULO_DA_FORMA[l.forma_pagamento] ?? l.forma_pagamento)
                      : '—'}
                  </td>
                  <td className="py-2 pr-4">{l.observacao ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
