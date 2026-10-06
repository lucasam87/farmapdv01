import { criarClienteServidor } from '@/lib/supabase/server'

export type Papel = 'dono' | 'atendente'

export type Perfil = {
  id: string
  nome: string
  papel: Papel
}

/**
 * Perfil de quem está logado, ou `null` se não houver sessão ou se o usuário
 * não tiver linha em `perfis`.
 *
 * Não existe autocadastro: um usuário do Auth sem linha em `perfis` não entra
 * no sistema (o layout de `app/(app)` mostra "Usuário sem perfil cadastrado").
 */
export async function perfilAtual(): Promise<Perfil | null> {
  const supabase = await criarClienteServidor()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data } = await supabase
    .from('perfis')
    .select('id, nome, papel')
    .eq('id', user.id)
    .eq('ativo', true)
    .maybeSingle()

  return (data as Perfil | null) ?? null
}
