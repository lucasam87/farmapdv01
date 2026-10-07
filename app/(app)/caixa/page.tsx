import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'
import { TelaCaixa, type MovimentoCaixa, type SessaoCaixa } from './tela'

// Tela de caixa. Le a sessao aberta da view `v_caixa_atual`, que ja traz a conta
// da spec 8.3 pronta (valor inicial + dinheiro que entrou − dinheiro que saiu).
//
// Se nao ha sessao aberta, a tela so oferece abrir — nao ha nada para mostrar.
export default async function CaixaPage() {
  const perfil = await perfilAtual()
  const supabase = await criarClienteServidor()

  // `v_caixa_atual` tem UMA LINHA POR TERMINAL aberto — com dois terminais (o
  // e2e cria um 'e2e' alem do 'balcao'), `maybeSingle()` falha e a tela mostraria
  // "nao ha caixa aberto" com o caixa aberto. Pegamos a sessao MAIS RECENTE, que
  // e exatamente o que `registrar_venda` e `caixa_movimento` fazem
  // (`where status = 'aberto' order by aberto_em desc limit 1`): a tela e as RPCs
  // tem de apontar para a mesma sessao, senao o resumo mente.
  const { data: sessao } = await supabase
    .from('v_caixa_atual')
    .select('*')
    .order('aberto_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  let movimentos: MovimentoCaixa[] = []
  if (sessao) {
    const { data } = await supabase
      .from('caixa_movimentos')
      .select('id, tipo, forma, valor, motivo, criado_em')
      .eq('sessao_id', (sessao as SessaoCaixa).sessao_id)
      .order('criado_em', { ascending: false })
      .limit(50)
    movimentos = (data ?? []) as MovimentoCaixa[]
  }

  return (
    <TelaCaixa
      sessao={(sessao as SessaoCaixa | null) ?? null}
      movimentos={movimentos}
      ehDono={perfil?.papel === 'dono'}
    />
  )
}
