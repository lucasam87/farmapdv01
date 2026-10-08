import { NextResponse } from 'next/server'
import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'
import { filtroDeBuscaDeCliente, filtroDeBuscaDeDevedor } from '@/lib/postgrest'
import {
  LIMITE_DA_BUSCA,
  juntarClientes,
  type LinhaCliente,
  type LinhaDevedor,
  type LinhaSaldo,
} from './fusao'

// Busca de cliente do PDV (item 8 da revisao da etapa 6).
//
// POR QUE ISTO EXISTE: a tela da nova venda carregava os 500 primeiros clientes
// em ordem alfabetica e o PDV mostrava um `<select>`. Cliente fora do corte —
// qualquer um depois do 500o nome, e a base veio inteira do sistema antigo —
// simplesmente NAO CONSEGUIA comprar no crediario. A busca acha qualquer cliente,
// por nome, telefone ou CPF.
//
// E uma rota de API e nao uma Server Action pelo mesmo motivo da busca de produto
// (app/api/produtos/busca/route.ts): o balcao chama isto a cada tecla, e uma
// Server Action por tecla seria pior (alem de nao poder ser chamada de um input
// sem form).
//
// Devolve o SALDO de cada cliente porque o PDV mostra quanto do limite ja foi
// usado antes de fechar no crediario. O saldo vem de `v_clientes_devedores`, a
// MESMA view do crediario: recalcular "compra − pagamento" aqui seria uma segunda
// definicao de divida, livre para divergir da primeira.
//
// A rota so CONSULTA, em tres idas ao banco: os devedores (a view), o resto (a
// tabela) e os saldos dos ids que vieram do resto (a view de novo — ver o
// comentario da terceira consulta). Juntar as origens (devedores primeiro, sem
// repetir, cortando em 8) e a funcao PURA `juntarClientes`, em ./fusao.ts, com teste
// de unidade — e onde as regras que erram calado ficam de fato provadas.

export async function GET(request: Request) {
  const perfil = await perfilAtual()
  if (!perfil) {
    return NextResponse.json({ erro: 'sem sessão' }, { status: 401 })
  }

  const termo = (new URL(request.url).searchParams.get('termo') ?? '').trim()
  if (termo.length < 2) {
    return NextResponse.json({ clientes: [] })
  }

  const supabase = await criarClienteServidor()

  // DEVEDORES PRIMEIRO, pelas duas razoes que o balcao tem para escolher alguem:
  // e o cliente que esta devendo (cobranca, recebimento) ou e a venda no
  // crediario. A view ja devolve o saldo, e o `order` repete o dela porque o
  // filtro `or` nao preserva a ordenacao declarada na view.
  //
  // O filtro e o `...DeDevedor` e NAO o de cliente: a view nao expoe `cpf`
  // (005_views.sql), e um termo com digito poria `cpf.ilike` na consulta — o
  // PostgREST recusaria a consulta INTEIRA por coluna inexistente e a busca do
  // balcao diria "nenhum cliente" para quem esta na frente do operador. Ver
  // lib/postgrest.ts.
  const { data: devedores, error: erroDevedores } = await supabase
    .from('v_clientes_devedores')
    .select('cliente_id, nome, telefone, limite_credito, saldo')
    .or(filtroDeBuscaDeDevedor(termo))
    .order('saldo', { ascending: false })
    .limit(LIMITE_DA_BUSCA)

  if (erroDevedores) {
    return NextResponse.json({ erro: 'não foi possível buscar' }, { status: 500 })
  }

  const linhasDevedor = (devedores ?? []) as LinhaDevedor[]

  // Quem nao deve NAO APARECE na view, e mesmo assim precisa poder ser escolhido:
  // o cliente que paga em dinheiro entra na venda do mesmo jeito (e o crediario
  // dele quem recusa, na RPC, com a mensagem da spec 9). A tabela tem o CPF que a
  // view nao tem, entao aqui vale o filtro de cliente completo.
  //
  // Esta consulta so acontece se ainda faltar gente para os 8, e pede 8 linhas DE
  // PROPOSITO: um devedor pode estar entre elas (a busca por nome casa os dois
  // lados), e o dedupe e o corte sao da `juntarClientes` — com o corte aplicado em
  // cada consulta, a lista fecharia com menos de 8 clientes sem haver menos de 8
  // clientes.
  let linhasDemais: LinhaCliente[] = []
  if (linhasDevedor.length < LIMITE_DA_BUSCA) {
    const { data, error } = await supabase
      .from('clientes')
      .select('id, nome, telefone, limite_credito')
      .or(filtroDeBuscaDeCliente(termo))
      .order('nome')
      .limit(LIMITE_DA_BUSCA)

    if (error) {
      return NextResponse.json({ erro: 'não foi possível buscar' }, { status: 500 })
    }

    linhasDemais = (data ?? []) as LinhaCliente[]
  }

  // O SALDO DE QUEM VEIO DE BAIXO, e esta consulta existe por causa do CPF: a view
  // nao expoe `cpf` (005_views.sql), entao o cliente que o operador acha digitando o
  // CPF chega pelo ramo de CIMA — e o saldo dele nao esta entre as linhas que o
  // primeiro ramo devolveu. Sem esta consulta, `juntarClientes` gravaria 0 (o que
  // era o defeito do Important 1 da revisao final do branch) e o PDV imprimiria
  // "deve R$ 0,00" para quem deve: o operador fecharia um crediario que o banco vai
  // recusar, em cima de uma informacao de dinheiro errada. A view e a MESMA do
  // crediario — nada de recalcular divida aqui.
  //
  // Falha na consulta NAO vira saldo zero: seria trocar o erro pelo mesmo defeito
  // (o cliente que deve voltando a aparecer quitado). A rota devolve 500 e o PDV
  // diz "Não foi possível buscar. Tente de novo." (M3 da mesma revisao).
  let saldosDosDemais: LinhaSaldo[] = []
  if (linhasDemais.length > 0) {
    const { data, error } = await supabase
      .from('v_clientes_devedores')
      .select('cliente_id, saldo')
      .in(
        'cliente_id',
        linhasDemais.map((c) => c.id),
      )

    if (error) {
      return NextResponse.json({ erro: 'não foi possível buscar' }, { status: 500 })
    }

    saldosDosDemais = (data ?? []) as LinhaSaldo[]
  }

  return NextResponse.json({
    clientes: juntarClientes(linhasDevedor, linhasDemais, saldosDosDemais),
  })
}
