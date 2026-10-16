import { createBrowserClient } from '@supabase/ssr'
import { ambienteSupabase } from './ambiente'

/**
 * Cliente Supabase para uso em Client Components ('use client').
 *
 * Só enxerga a chave PÚBLICA (NEXT_PUBLIC_*). Ela é segura no navegador porque
 * toda TABELA tem RLS ativado — mas isso não bastava: a view só respeita a RLS
 * da tabela de base com `security_invoker = true`, e sem isso a chave pública
 * lia os dados direto da view. A migration `013_seguranca_views` põe esse
 * atributo nas 11 views de `public`; view nova sem ele reabre o buraco.
 * A chave secreta nunca chega aqui.
 */
export function criarClienteNavegador() {
  const { url, chavePublica } = ambienteSupabase()
  return createBrowserClient(url, chavePublica)
}
