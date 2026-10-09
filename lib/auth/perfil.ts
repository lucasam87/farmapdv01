import { criarClienteServidor } from '@/lib/supabase/server'

export type Papel = 'dono' | 'atendente'

export type Perfil = {
  id: string
  nome: string
  papel: Papel
}

/**
 * Sessão e perfil em uma única ida ao banco.
 *
 * Existe porque a rota do agente precisa separar DUAS recusas diferentes com o
 * mesmo `perfilAtual` nulo: sem sessão (401) e com sessão mas sem perfil ativo
 * (403). Como `perfilAtual()` devolve `null` nos dois casos, distinguir exigiria
 * uma segunda chamada de `getUser()` — e esta função faz a distinção sem custo
 * extra, criando um cliente só.
 */
export async function autenticacaoAtual(): Promise<{ sessao: boolean; perfil: Perfil | null }> {
  const supabase = await criarClienteServidor()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { sessao: false, perfil: null }

  const { data } = await supabase
    .from('perfis')
    .select('id, nome, papel')
    .eq('id', user.id)
    .eq('ativo', true)
    .maybeSingle()

  return { sessao: true, perfil: (data as Perfil | null) ?? null }
}

/**
 * Perfil de quem está logado, ou `null` se não houver sessão ou se o usuário
 * não tiver linha em `perfis`.
 *
 * Não existe autocadastro: um usuário do Auth sem linha em `perfis` não entra
 * no sistema (o layout de `app/(app)` mostra "Usuário sem perfil cadastrado").
 */
export async function perfilAtual(): Promise<Perfil | null> {
  return (await autenticacaoAtual()).perfil
}
