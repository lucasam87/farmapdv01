import { notFound } from 'next/navigation'
import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'
import { rotuloDoDia, type VendaHistorico } from '../dia'
import { TelaVenda, type ItemVenda, type PagamentoVenda } from './tela'

// O detalhe da venda (spec §10: lista enxuta, detalhe ao clicar). A tela é server
// porque busca os dados; a parte interativa (o cancelamento) vive em `tela.tsx`.
//
// O dia NÃO é lido do endereço: quem manda é `venda.dia`, que já vem da view no
// fuso de São Paulo. Assim o "Voltar para o dia" volta para o dia em que a venda
// aconteceu, mesmo que o endereço venha sem `dia` ou com um dia torto.

const COLUNAS =
  'venda_id, numero, dia, criado_em, cliente_id, cliente_nome, subtotal, desconto, total, troco, itens, formas, status, cancelado_em, cancelado_por_nome, motivo_cancelamento'

export default async function VendaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ ocultar?: string }>
}) {
  const { id } = await params
  const { ocultar } = await searchParams
  const oculto = Boolean(ocultar)

  const supabase = await criarClienteServidor()

  // `.maybeSingle()`: id que não existe (ou que nem é uuid) vira 404, nunca 500.
  const { data } = await supabase
    .from('v_vendas_historico')
    .select(COLUNAS)
    .eq('venda_id', id)
    .maybeSingle()

  if (!data) notFound()
  const venda = data as VendaHistorico

  // Os itens vêm da própria venda (nome e preço ficam congelados no item: mudar o
  // produto depois não reescreve o passado). `id` entra junto para ser a chave da
  // linha — dois produtos diferentes podem ter o mesmo nome.
  const { data: itensBruto } = await supabase
    .from('venda_itens')
    .select('id, nome_produto, quantidade, preco_unitario, total')
    .eq('venda_id', id)
    .order('nome_produto')

  const { data: pagamentosBruto } = await supabase
    .from('venda_pagamentos')
    .select('id, forma, valor')
    .eq('venda_id', id)
    .order('forma')

  const perfil = await perfilAtual()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  return (
    <TelaVenda
      venda={venda}
      itens={(itensBruto ?? []) as ItemVenda[]}
      pagamentos={(pagamentosBruto ?? []) as PagamentoVenda[]}
      oculto={oculto}
      ehDono={perfil?.papel === 'dono'}
      rotulo={rotuloDoDia(venda.dia, hoje)}
    />
  )
}
