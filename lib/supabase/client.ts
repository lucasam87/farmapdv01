import { createBrowserClient } from '@supabase/ssr'

/**
 * Cliente Supabase para uso em Client Components ('use client').
 *
 * Só enxerga a chave PÚBLICA (NEXT_PUBLIC_*), que é segura no navegador porque
 * toda tabela tem RLS ativado. A chave secreta nunca chega aqui.
 */
export function criarClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
