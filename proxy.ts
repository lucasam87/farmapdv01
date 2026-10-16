import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { rotaPublica } from '@/lib/auth/rotas'
import { ambienteSupabase } from '@/lib/supabase/ambiente'

/**
 * No Next 16 o antigo `middleware.ts` passou a se chamar `proxy.ts`, e a função
 * exportada passou a se chamar `proxy`. O runtime aqui é Node.js (o runtime
 * `edge` não é suportado em proxy).
 *
 * Este arquivo faz uma checagem OTIMISTA: redireciona quem não tem sessão para
 * o login. A autorização de verdade fica no layout de `app/(app)`, que consulta
 * a tabela `perfis` — a própria documentação do Next 16 avisa que o proxy não
 * deve ser a única solução de autorização.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  // As duas variáveis são lidas por aqui, e não direto do `process.env`, para a
  // falta delas virar uma mensagem que diz o que fazer — ver
  // `lib/supabase/ambiente.ts`. Este é o primeiro código que roda em qualquer
  // rota, então é aqui que um clone sem `.env.local` quebra.
  const { url, chavePublica } = ambienteSupabase()

  const supabase = createServerClient(url, chavePublica, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        // Repassa os cookies para a requisição (o Server Component os lê)
        // e escreve a resposta nova com eles.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
        // Sem estes cabeçalhos, um CDN (a Vercel) pode cachear uma resposta
        // com token de sessão e servir a um usuário diferente.
        Object.entries(headers).forEach(([chave, valor]) => {
          response.headers.set(chave, valor)
        })
      },
    },
  })

  // getUser() valida o token no servidor de Auth.
  // getSession() apenas lê o cookie, sem validar — não serve para decidir acesso.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !rotaPublica(request.nextUrl.pathname)) {
    const destino = request.nextUrl.clone()
    destino.pathname = '/login'
    destino.search = ''
    const redirecionamento = NextResponse.redirect(destino)
    // O redirect precisa levar junto os cookies que o Supabase acabou de
    // renovar, senão a sessão recém-atualizada se perde.
    for (const cookie of response.cookies.getAll()) {
      redirecionamento.cookies.set(cookie)
    }
    return redirecionamento
  }

  return response
}

export const config = {
  matcher: [
    // Roda em tudo, menos arquivos estáticos e imagens.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)',
  ],
}
