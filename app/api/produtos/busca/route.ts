import { NextResponse } from 'next/server'
import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'

// Busca de produto do PDV. E uma rota de API e nao uma Server Action porque o
// PDV chama isto a cada tecla: uma Server Action por tecla seria pior (e nao
// pode ser chamada de um input sem form).
//
// Devolve SO o que o carrinho precisa mostrar. Nada de custo.

export async function GET(request: Request) {
  const perfil = await perfilAtual()
  if (!perfil) {
    return NextResponse.json({ erro: 'sem sessão' }, { status: 401 })
  }

  const termo = (new URL(request.url).searchParams.get('termo') ?? '').trim()
  if (termo.length < 2) {
    return NextResponse.json({ produtos: [] })
  }

  const supabase = await criarClienteServidor()

  // Codigo de barras exato (o leitor manda o codigo inteiro e da Enter) OU
  // pedaco do nome. So ativos: produto inativo nao vende.
  const { data, error } = await supabase
    .from('produtos')
    .select('id, codigo_barras, nome, preco_venda, estoque_atual')
    .eq('ativo', true)
    .or(`codigo_barras.eq.${termo},nome.ilike.%${termo}%`)
    .order('nome')
    .limit(8)

  if (error) {
    return NextResponse.json({ erro: 'não foi possível buscar' }, { status: 500 })
  }

  return NextResponse.json({ produtos: data ?? [] })
}
