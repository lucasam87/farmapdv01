import { criarClienteServidor } from '@/lib/supabase/server'
import { Pdv } from './pdv'

type LinhaDevedor = {
  cliente_id: string
  nome: string
  limite_credito: number
  saldo: number
}

// O PDV carrega junto a lista de clientes (com o saldo devedor) porque a escolha
// do cliente acontece no meio da venda e nao pode esperar uma ida ao servidor.
// A view ja traz quem deve e o limite; quem nao deve nao aparece nela, entao a
// lista e completada com os demais clientes ativos.
export default async function NovaVendaPage() {
  const supabase = await criarClienteServidor()

  const { data: devedores } = await supabase
    .from('v_clientes_devedores')
    .select('cliente_id, nome, telefone, limite_credito, saldo')
    .order('saldo', { ascending: false })
    .limit(200)

  const { data: todos } = await supabase
    .from('clientes')
    .select('id, nome, limite_credito')
    .order('nome')
    .limit(500)

  const saldoPorCliente = new Map<string, number>(
    ((devedores ?? []) as LinhaDevedor[]).map((d) => [d.cliente_id, d.saldo]),
  )

  const clientes = ((todos ?? []) as { id: string; nome: string; limite_credito: number }[]).map((c) => ({
    id: c.id,
    nome: c.nome,
    limite_credito: c.limite_credito,
    saldo: saldoPorCliente.get(c.id) ?? 0,
  }))

  return <Pdv clientes={clientes} />
}
