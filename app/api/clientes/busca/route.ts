import { NextResponse } from 'next/server'
import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'
import { filtroDeBuscaDeCliente, filtroDeBuscaDeDevedor } from '@/lib/postgrest'

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

const LIMITE = 8

type LinhaDevedor = {
  cliente_id: string
  nome: string
  telefone: string | null
  limite_credito: number
  // A view devolve `bigint` (a soma). O `number | string` e de proposito: /crediario
  // ja registra a armadilha — se o saldo da view chegar como TEXTO, somar sem
  // normalizar concatena em vez de somar, e `formatarMoeda` nao estoura com texto,
  // ele mostra o valor errado calado. A normalizacao e UMA, aqui na leitura, para
  // nenhuma tela a jusante ter de lembrar disso.
  saldo: number | string
}

type LinhaCliente = {
  id: string
  nome: string
  telefone: string | null
  limite_credito: number
}

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
    .limit(LIMITE)

  if (erroDevedores) {
    return NextResponse.json({ erro: 'não foi possível buscar' }, { status: 500 })
  }

  const clientes = ((devedores ?? []) as LinhaDevedor[]).map((d) => ({
    id: d.cliente_id,
    nome: d.nome,
    telefone: d.telefone,
    limite_credito: d.limite_credito,
    saldo: Number(d.saldo),
  }))

  // Quem nao deve NAO APARECE na view, e mesmo assim precisa poder ser escolhido:
  // o cliente que paga em dinheiro entra na venda do mesmo jeito (e o crediario
  // dele quem recusa, na RPC, com a mensagem da spec 9). A tabela tem o CPF que a
  // view nao tem, entao aqui vale o filtro de cliente completo.
  if (clientes.length < LIMITE) {
    const { data: demais, error: erroDemais } = await supabase
      .from('clientes')
      .select('id, nome, telefone, limite_credito')
      .or(filtroDeBuscaDeCliente(termo))
      .order('nome')
      .limit(LIMITE)

    if (erroDemais) {
      return NextResponse.json({ erro: 'não foi possível buscar' }, { status: 500 })
    }

    // O corte de 8 e sobre a LISTA, nao sobre cada consulta: quem ja veio da view
    // sai daqui, e a consulta pede 8 linhas de proposito — um devedor pode estar
    // entre elas (a busca por nome casa os dois), e sem a folga a lista fecharia
    // com menos de 8 clientes sem haver menos de 8 clientes.
    const jaVistos = new Set(clientes.map((c) => c.id))
    for (const c of (demais ?? []) as LinhaCliente[]) {
      if (clientes.length === LIMITE) break
      if (jaVistos.has(c.id)) continue
      jaVistos.add(c.id)
      clientes.push({
        id: c.id,
        nome: c.nome,
        telefone: c.telefone,
        limite_credito: c.limite_credito,
        saldo: 0,
      })
    }
  }

  return NextResponse.json({ clientes })
}
