import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

/**
 * Cliente Supabase para Server Components, Server Actions e rotas de API.
 *
 * Sempre cria um cliente novo por requisição: reutilizar um cliente entre
 * requisições deixaria respostas sem os cabeçalhos de cache que a biblioteca
 * exige quando escreve cookies de sessão.
 */
export async function criarClienteServidor() {
  // No Next 16 `cookies()` só pode ser lido de forma assíncrona.
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          // Server Component não pode escrever cookie. A renovação de sessão
          // acontece no proxy.ts, que é quem monta a resposta HTTP — é lá que
          // os cabeçalhos de cache (no-store) também são aplicados.
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Esperado quando chamado durante a renderização de um Server
            // Component. Ignorar aqui é intencional: o proxy já cuidou disso.
          }
        },
      },
    },
  )
}
