/**
 * As duas variaveis PUBLICAS do Supabase, lidas num lugar so.
 *
 * Por que existe: o clone NAO traz `.env.local` — o arquivo nunca vai para o git —,
 * e sem as variaveis o `createServerClient` estoura com
 *
 *   "Your project's URL and Key are required to create a Supabase client!"
 *
 * que nao diz QUAL variavel falta nem onde preencher. Pior: o estouro acontece no
 * `proxy.ts`, o primeiro codigo que roda em qualquer rota, entao aquela mensagem e
 * a PRIMEIRA coisa que alguem ve ao subir o projeto — antes de qualquer log util.
 *
 * Aqui a falta vira uma mensagem que nomeia a variavel, aponta o modelo a copiar e
 * diz onde as chaves estao.
 *
 * As duas continuam sendo lidas pelo nome LITERAL `process.env.NEXT_PUBLIC_*`: e
 * assim que o Next troca o valor no bundle do cliente. Ler por indice
 * (`process.env[nome]`) nao funcionaria do lado do navegador.
 */
export function ambienteSupabase(): { url: string; chavePublica: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const chavePublica = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  const faltando: string[] = []
  if (!url) faltando.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!chavePublica) faltando.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')

  if (!url || !chavePublica) {
    throw new Error(
      `Falta ${faltando.join(' e ')} no ambiente. ` +
        'Copie o `.env.example` para `.env.local` (ele nao vai para o git) e preencha ' +
        'com as chaves do projeto: Supabase -> Project Settings -> Data API (a URL) e ' +
        'API Keys (a chave publica). Sem isso o sistema nao autentica ninguem e ' +
        'nenhuma tela abre.',
    )
  }

  return { url, chavePublica }
}
