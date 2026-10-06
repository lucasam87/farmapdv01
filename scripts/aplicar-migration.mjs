// Aplica migrations no projeto Supabase.
//
// Por que existe: a senha do banco (SUPABASE_DB_URL) nunca autenticou, entao
// `supabase db push` e `psql` nao funcionam. O caminho que funciona e o endpoint
// de gerenciamento, autenticado pelo Personal Access Token.
//
//   uso: node scripts/aplicar-migration.mjs                 (todas, em ordem)
//        node scripts/aplicar-migration.mjs 004_caixa.sql   (uma)
//
// Sai com codigo 1 se qualquer arquivo falhar. As migrations deste projeto sao
// escritas para poderem rodar de novo (create ... if not exists / create or
// replace / drop policy if exists), mas o normal e aplicar so a nova.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import dotenv from 'dotenv'

const raiz = path.resolve(import.meta.dirname, '..')
const dirMigrations = path.join(raiz, 'supabase', 'migrations')

dotenv.config({ path: path.join(raiz, '.env.local'), quiet: true })

const token = process.env.SUPABASE_ACCESS_TOKEN
const urlProjeto = process.env.NEXT_PUBLIC_SUPABASE_URL

if (!token || !urlProjeto) {
  console.error('Faltam SUPABASE_ACCESS_TOKEN ou NEXT_PUBLIC_SUPABASE_URL no .env.local')
  process.exitCode = 1
} else {
  const ref = new URL(urlProjeto).hostname.split('.')[0]
  const endpoint = 'https://api.supabase.com/v1/projects/' + ref + '/database/query'

  const pedido = process.argv[2]
  const arquivos = pedido
    ? [pedido]
    : fs.readdirSync(dirMigrations).filter((nome) => nome.endsWith('.sql')).sort()

  if (arquivos.length === 0) {
    console.error('Nenhuma migration encontrada em supabase/migrations/')
    process.exitCode = 1
  } else {
    let falhas = 0

    for (const arquivo of arquivos) {
      const caminho = path.isAbsolute(arquivo) ? arquivo : path.join(dirMigrations, path.basename(arquivo))
      if (!fs.existsSync(caminho)) {
        console.log('FALHOU ' + arquivo + ': arquivo nao encontrado')
        falhas++
        continue
      }

      const query = fs.readFileSync(caminho, 'utf8')
      let resposta
      let texto
      try {
        resposta = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        })
        texto = await resposta.text()
      } catch (erro) {
        console.log('FALHOU ' + arquivo + ': falha de rede — ' + erro.message)
        falhas++
        continue
      }

      if (!resposta.ok) {
        console.log('FALHOU ' + arquivo + ': HTTP ' + resposta.status + ' — ' + texto.slice(0, 400))
        // O endpoint nao usa transacao por arquivo: parte das instrucoes pode
        // ter sido aplicada antes do erro. Conferir antes de seguir.
        console.log('ATENCAO: parte das instrucoes pode ter sido aplicada. Confira o banco antes de repetir.')
        falhas++
        continue
      }

      console.log('OK    ' + arquivo + ' (' + query.length + ' chars, HTTP ' + resposta.status + ')')
    }

    console.log('')
    console.log((arquivos.length - falhas) + ' de ' + arquivos.length + ' migrations aplicadas')
    process.exitCode = falhas > 0 ? 1 : 0
  }
}
