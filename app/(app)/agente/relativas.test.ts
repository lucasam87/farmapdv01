import dotenv from 'dotenv'
import { describe, expect, it } from 'vitest'

dotenv.config({ path: '.env.local', quiet: true })

import { classificarFinanceiro } from '@/lib/agente/deepseek'
import { validarConsultaFinanceiro } from './logica'

// ============================================================
// A UNICA prova possivel de que a tabela de conversao de tempo FUNCIONA.
//
// Os testes unitarios provam que o formato e aceito; eles NAO provam que o modelo
// converte "essa semana" nas datas certas. Isso so se prova contra a API real — e
// foi assim que o defeito apareceu: *"Como o pessoal pagou essa semana?"* caia no
// padrao de 30 dias e a resposta saia CERTA para o periodo ERRADO.
//
// ⚠️ **NAO roda na suite normal**: gasta chamadas pagas e depende de rede. Rode
// quando mexer no `promptFinanceiro`:
//
//     $env:AGENTE_PROMPT_REAL='1'; npx vitest run app/(app)/agente/relativas.test.ts
//
// Sem a variavel, o bloco inteiro e PULADO — e o arquivo continua no repositorio
// como a ancora que faltava (achado da re-revisao de 16/10/2026: a evidencia da
// tabela era medicao manual, e nada prendia as sete conversoes).
// ============================================================

const REAL = process.env.AGENTE_PROMPT_REAL === '1'

const HOJE = '2026-10-15' // uma quinta-feira

const CASOS: { pergunta: string; de: string; ate: string }[] = [
  { pergunta: 'Quanto faturei hoje?', de: '2026-10-15', ate: '2026-10-15' },
  { pergunta: 'Quanto faturei ontem?', de: '2026-10-14', ate: '2026-10-14' },
  // Segunda-feira da semana de 15/10/2026 e 12/10.
  { pergunta: 'Como o pessoal pagou essa semana?', de: '2026-10-12', ate: '2026-10-15' },
  { pergunta: 'Quanto faturei semana passada?', de: '2026-10-05', ate: '2026-10-11' },
  { pergunta: 'Quanto faturei esse mês?', de: '2026-10-01', ate: '2026-10-15' },
  { pergunta: 'Quanto lucrei no mês passado?', de: '2026-09-01', ate: '2026-09-30' },
]

describe.skipIf(!REAL)('as referencias relativas de tempo, contra a API real', () => {
  it('converte cada referencia no par de datas certo', async () => {
    const erros: string[] = []

    for (const caso of CASOS) {
      const r = await classificarFinanceiro(caso.pergunta, HOJE)
      if (!r.ok) {
        erros.push(`"${caso.pergunta}": falha de rede (${r.fase})`)
        continue
      }

      const saida = validarConsultaFinanceiro(r.conteudo, HOJE)
      if (!saida.ok) {
        erros.push(`"${caso.pergunta}": recusado (${saida.motivo}) — ${r.conteudo.trim()}`)
        continue
      }
      if (saida.consulta.de !== caso.de || saida.consulta.ate !== caso.ate) {
        erros.push(
          `"${caso.pergunta}": veio ${saida.consulta.de}..${saida.consulta.ate}, ` +
            `esperado ${caso.de}..${caso.ate}`,
        )
      }
    }

    expect(erros).toEqual([])
  }, 180_000)

  it('periodo grande demais e RECUSADO por tamanho — nunca encurtado em silencio', async () => {
    // A falha que o prompt tem de impedir: encurtar "esse ano" para 31 dias faria a
    // resposta sair CERTA para o periodo ERRADO, sem ninguem perceber. O que se
    // aceita aqui e a recusa honesta ('periodo'), nunca um periodo menor.
    const r = await classificarFinanceiro('Quanto faturei esse ano?', HOJE)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const saida = validarConsultaFinanceiro(r.conteudo, HOJE)
    if (!saida.ok) {
      expect(saida.motivo).toBe('periodo')
      return
    }

    // Se ele devolveu um periodo, que seja o REAL pedido — nunca um encurtado.
    const dias =
      (Date.parse(`${saida.consulta.ate}T00:00:00Z`) - Date.parse(`${saida.consulta.de}T00:00:00Z`)) /
        86_400_000 +
      1
    expect(dias).toBeGreaterThan(31)
  }, 60_000)
})

// ⚠️ Achado M5 da revisao da rodada 2: aqui existia um `it` que fazia
// `expect(REAL).toBe(process.env.AGENTE_PROMPT_REAL === '1')` — como `REAL` E essa
// expressao, aquilo era `x === x`: nunca falhava e nao protegia nada. A protecao de
// verdade e o `describe.skipIf` acima, e ela e verificada rodando a suite (o arquivo
// reporta "2 skipped") — nao por uma assercao tautologica.
