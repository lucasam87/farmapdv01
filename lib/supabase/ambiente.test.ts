import { describe, it, expect, afterEach, vi } from 'vitest'
import { ambienteSupabase } from './ambiente'

// O erro que este modulo existe para matar (medido em 15/10/2026, num clone sem
// `.env.local`): a primeira rota morre no `proxy.ts` com
//
//   "Your project's URL and Key are required to create a Supabase client!"
//
// que nao nomeia a variavel, nao diz onde preencher e nao sugere o `.env.example`.
// O que se prova aqui e que a falta vira uma mensagem acionavel — e que as duas
// variaveis certas sao devolvidas quando existem.

describe('ambienteSupabase', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('devolve as duas variaveis quando estao preenchidas', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://exemplo.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'chave-publica')

    expect(ambienteSupabase()).toEqual({
      url: 'https://exemplo.supabase.co',
      chavePublica: 'chave-publica',
    })
  })

  it('nomeia SO a variavel que falta, e aponta o .env.example', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'chave-publica')

    expect(() => ambienteSupabase()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
    expect(() => ambienteSupabase()).toThrow(/\.env\.example/)
    // E nao acusa a que existe: mensagem que aponta o culpado errado faz perder tempo.
    expect(() => ambienteSupabase()).not.toThrow(/ANON_KEY/)
  })

  it('acusa as duas quando nao ha nenhuma', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')

    expect(() => ambienteSupabase()).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    )
  })

  it('espaco em branco conta como ausente', () => {
    // Um `.env.local` com `NEXT_PUBLIC_SUPABASE_URL=` e espacos nao esta preenchido;
    // tratar isso como valor valido mandaria a requisicao para lugar nenhum.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '   ')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'chave-publica')

    expect(() => ambienteSupabase()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('devolve o valor sem espaco nas pontas', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '  https://exemplo.supabase.co  ')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ' chave-publica ')

    expect(ambienteSupabase()).toEqual({
      url: 'https://exemplo.supabase.co',
      chavePublica: 'chave-publica',
    })
  })
})
