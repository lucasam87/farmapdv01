// Runner dos testes SQL (Etapa 2).
//
// Cada arquivo de tests/sql/casos/*.sql roda numa transacao propria:
//   BEGIN -> _helper.sql -> _fixtures.sql -> caso -> select do log -> ROLLBACK
// Nada sobrevive: nenhum caso suja o banco.
//
// Transporte: endpoint de gerenciamento /database/query com o
// SUPABASE_ACCESS_TOKEN, porque a senha do banco (SUPABASE_DB_URL) nunca
// autenticou. Sonda comprovou que o endpoint nao devolve raise notice, mas
// devolve as linhas do ultimo select que produziu linhas — por isso teste_ok
// grava o nome da assercao num log temporario em vez de notificar.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import dotenv from 'dotenv'

const raiz = path.resolve(import.meta.dirname, '..', '..')
const sqlDir = path.join(raiz, 'tests', 'sql')
const casosDir = path.join(sqlDir, 'casos')

dotenv.config({ path: path.join(raiz, '.env.local'), quiet: true })

// O corpo de erro vem como
// {"message":"Failed to run sql query: ERROR:  P0001: FALHOU: ...\nCONTEXT: ..."}
function resumirErro(texto) {
  let mensagem = texto
  try {
    const corpo = JSON.parse(texto)
    if (corpo && corpo.message) mensagem = corpo.message
  } catch {
    // corpo nao era JSON: usa o texto cru
  }
  const achado = mensagem.match(/ERROR:\s*(?:[0-9A-Z]{5}:\s*)?([\s\S]*?)(?:\nCONTEXT:|$)/)
  return (achado ? achado[1] : mensagem).trim().replace(/\s+/g, ' ')
}

function extrairOks(texto) {
  const linhas = JSON.parse(texto)
  const primeira = Array.isArray(linhas) ? linhas[0] : null
  return primeira && Array.isArray(primeira.oks) ? primeira.oks : []
}

const token = process.env.SUPABASE_ACCESS_TOKEN
const urlProjeto = process.env.NEXT_PUBLIC_SUPABASE_URL

if (!token || !urlProjeto) {
  console.error('Faltam SUPABASE_ACCESS_TOKEN ou NEXT_PUBLIC_SUPABASE_URL no .env.local')
  process.exitCode = 1
} else {
  const ref = new URL(urlProjeto).hostname.split('.')[0]
  const endpoint = 'https://api.supabase.com/v1/projects/' + ref + '/database/query'

  const preludio = [
    fs.readFileSync(path.join(sqlDir, '_helper.sql'), 'utf8'),
    fs.readFileSync(path.join(sqlDir, '_fixtures.sql'), 'utf8'),
  ].join('\n')

  // O select do log precisa vir depois do caso e antes do ROLLBACK: e a ultima
  // instrucao com linhas, entao e ela que o endpoint devolve.
  const rodape = [
    "select coalesce(json_agg(nome order by ordem), '[]'::json) as oks from teste_log;",
    'rollback;',
  ].join('\n')

  const arquivos = fs
    .readdirSync(casosDir)
    .filter((arquivo) => arquivo.endsWith('.sql'))
    .sort()

  if (arquivos.length === 0) {
    console.error('Nenhum caso encontrado em tests/sql/casos/*.sql')
    process.exitCode = 1
  } else {
    let oks = 0
    let falhas = 0

    for (const arquivo of arquivos) {
      const caso = fs.readFileSync(path.join(casosDir, arquivo), 'utf8')
      const query = ['begin;', preludio, caso, rodape].join('\n')

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
        console.log('FALHOU ' + arquivo + ': ' + resumirErro(texto))
        falhas++
        continue
      }

      const nomes = extrairOks(texto)
      for (const nome of nomes) console.log('OK  ' + nome)
      oks += nomes.length
    }

    console.log(oks + ' OK, ' + falhas + ' FALHOU de ' + arquivos.length + ' arquivos')
    // process.exit() logo apos um fetch derruba o processo no Node 24.
    process.exitCode = falhas > 0 ? 1 : 0
  }
}
