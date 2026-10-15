import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  classificar,
  mensagensDeClassificacao,
  bytesDoPayload,
  promptClassificacao,
  PROMPT_CLASSIFICACAO,
} from './deepseek'
import { LIMITE_PAYLOAD_BYTES, MAX_TOKENS_SAIDA, MODELO } from '@/app/(app)/agente/logica'

// O modulo server-only que fala com o DeepSeek. Estes testes NAO tocam a rede:
// `fetch` entra trocado por um espiao e as variaveis de ambiente sao isoladas por
// `vi.stubEnv`. O que se prova aqui e o que sai do servidor (destino, corpo e
// cabecalho), o que NUNCA sai (linha de banco, id, cookie) e como as falhas sao
// classificadas — pre-envio (libera reserva) contra ambigua (mantem reserva).

const PERGUNTA = 'Como foram as vendas de hoje?'
const CHAVE = 'chave-falsa-de-teste'
// A data de Sao Paulo do dia do achado, injetada como a orquestracao injeta.
const HOJE = '2026-10-14'

type CorpoEnviado = {
  model: string
  messages: { role: string; content: string }[]
  response_format: { type: string }
  thinking: { type: string }
  max_tokens: number
  stream: boolean
  temperature: number
}

function respostaHttp(corpo: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => corpo,
  } as unknown as Response
}

function espiaoDeFetch(corpo: unknown, ok = true, status = 200) {
  // O tipo generico declara os parametros do `fetch` sem precisar nomear
  // argumentos que o espiao nao usa (o corpo ja vem pronto de fora).
  return vi.fn<(destino: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
    respostaHttp(corpo, ok, status),
  )
}

function chamadaDeFetch(espiao: ReturnType<typeof espiaoDeFetch>): { destino: string; init: RequestInit } {
  const [destino, init] = espiao.mock.calls[0]!
  return { destino: String(destino), init: init as RequestInit }
}

async function corpoEnviado(espiao: ReturnType<typeof espiaoDeFetch>): Promise<CorpoEnviado> {
  const { init } = chamadaDeFetch(espiao)
  return JSON.parse(String(init.body)) as CorpoEnviado
}

beforeEach(() => {
  vi.stubEnv('DEEPSEEK_API_KEY', CHAVE)
  vi.stubEnv('DEEPSEEK_BASE_URL', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ============================================================
// Prompt fixo e payload: as duas exigencias do JSON Output.
// ============================================================

describe('prompt fixo', () => {
  it('contem a palavra json, o exemplo literal do objeto e as seis saidas do enum', () => {
    const prompt = PROMPT_CLASSIFICACAO.toLowerCase()

    // A doc do JSON Output exige as duas coisas: a palavra "json" e um exemplo
    // do formato desejado. Sem elas o modo JSON nao e ativado de verdade.
    expect(prompt).toContain('json')
    expect(PROMPT_CLASSIFICACAO).toContain('"intencao"')
    expect(PROMPT_CLASSIFICACAO).toContain('"de"')
    expect(PROMPT_CLASSIFICACAO).toContain('"ate"')
    expect(PROMPT_CLASSIFICACAO).toContain('"limite"')
    for (const intencao of [
      'vendas_dia',
      'mais_vendidos',
      'estoque_baixo',
      'estoque_parado',
      'margem_produto',
      'fora_escopo',
    ]) {
      expect(PROMPT_CLASSIFICACAO).toContain(intencao)
    }
  })

  // A quinta intencao (margem por produto) entra no prompt como as outras: e o
  // modelo so classifica; quem calcula percentual e monta o texto e `logica.ts`.
  it('o prompt de hoje ensina a intencao de margem e o periodo padrao dela', () => {
    const prompt = promptClassificacao(HOJE)

    expect(prompt).toContain('"margem_produto"')
    expect(prompt).toContain('margem')
    // "de"/"ate" aceitam AAAA-MM-DD e o padrao dela sao os ultimos 30 dias.
    expect(prompt).toContain('30 dias')
    // O teto continua o mesmo das outras intencoes com periodo.
    expect(prompt).toContain('31 dias')
  })

  it('as mensagens sao so o prompt fixo e a pergunta, nessa ordem', () => {
    expect(mensagensDeClassificacao(PERGUNTA, HOJE)).toEqual([
      { role: 'system', content: promptClassificacao(HOJE) },
      { role: 'user', content: PERGUNTA },
    ])
  })

  it('mede os BYTES do payload real (prompt + pergunta), nao so os da pergunta', () => {
    const bytes = (texto: string) => new TextEncoder().encode(texto).length

    expect(bytesDoPayload('', HOJE)).toBe(bytes(promptClassificacao(HOJE)))
    expect(bytesDoPayload('abc', HOJE)).toBe(bytes(promptClassificacao(HOJE)) + 3)
    // Acento e emoji contam mais de um byte: a conta tem que ser a do UTF-8 real.
    expect(bytesDoPayload('ção', HOJE)).toBe(bytes(promptClassificacao(HOJE)) + 5)
    expect(bytesDoPayload('😀', HOJE)).toBe(bytes(promptClassificacao(HOJE)) + 4)
  })

  it('o pior caso do limite de pergunta ainda cabe no payload (senao a checagem seria mentira)', () => {
    const piorCaso = '😀'.repeat(500)
    expect(bytesDoPayload(piorCaso, HOJE)).toBeLessThanOrEqual(LIMITE_PAYLOAD_BYTES)
  })
})

// ============================================================
// A DATA DE HOJE NO PROMPT — achado de 14/10/2026.
//
// O prompt pedia `null` em "de"/"ate" para "hoje" e NUNCA dizia que dia era hoje.
// Resultado medido em producao: a mesma pergunta respondeu 13/10 numa execucao e
// "nao ha vendas" na outra, porque o modelo chutava a data. A data agora entra no
// prompt, vinda do MESMO relogio injetado que decide o mes do orcamento.
// ============================================================

describe('a data de hoje no prompt', () => {
  it('carrega a data de Sao Paulo que recebeu', () => {
    expect(promptClassificacao(HOJE)).toContain(HOJE)
  })

  it('datas diferentes produzem prompts diferentes', () => {
    expect(promptClassificacao('2026-10-14')).not.toBe(promptClassificacao('2026-10-15'))
  })

  it('a mensagem de sistema enviada ao provedor e a que carrega a data', () => {
    expect(mensagensDeClassificacao(PERGUNTA, HOJE)[0]!.content).toContain(HOJE)
  })
})

// ============================================================
// Destino e conteudo enviado.
// ============================================================

describe('destino e conteudo enviado', () => {
  it('vai para o Chat Completions do DeepSeek com a chave no cabecalho', async () => {
    const espiao = espiaoDeFetch({ choices: [{ message: { content: '{}' } }], usage: {} })
    vi.stubGlobal('fetch', espiao)

    await classificar(PERGUNTA, HOJE)

    const { destino, init } = chamadaDeFetch(espiao)
    expect(destino).toBe('https://api.deepseek.com/chat/completions')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CHAVE}`)
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.body).not.toContain(CHAVE)
  })

  it('DEEPSEEK_BASE_URL troca o destino (e o padrao quando ela esta vazia)', async () => {
    const espiao = espiaoDeFetch({ choices: [{ message: { content: '{}' } }] })
    vi.stubGlobal('fetch', espiao)
    vi.stubEnv('DEEPSEEK_BASE_URL', 'http://127.0.0.1:3210')

    await classificar(PERGUNTA, HOJE)

    expect(chamadaDeFetch(espiao).destino).toBe('http://127.0.0.1:3210/chat/completions')
  })

  // Minor 9 da revisao final: em producao o destino e CRAVADO. Se a variavel
  // existisse tambem la, o header `Authorization: Bearer <chave>` inteiro iria
  // para o host que ela apontasse.
  it('em PRODUCAO o DEEPSEEK_BASE_URL e ignorado: a chave so vai para api.deepseek.com', async () => {
    const espiao = espiaoDeFetch({ choices: [{ message: { content: '{}' } }] })
    vi.stubGlobal('fetch', espiao)
    vi.stubEnv('DEEPSEEK_BASE_URL', 'https://host-de-terceiro.exemplo')
    vi.stubEnv('NODE_ENV', 'production')

    await classificar(PERGUNTA, HOJE)

    expect(chamadaDeFetch(espiao).destino).toBe('https://api.deepseek.com/chat/completions')
  })

  it('o corpo leva so o modelo, as duas mensagens e os limites — nada de banco', async () => {
    const espiao = espiaoDeFetch({ choices: [{ message: { content: '{}' } }] })
    vi.stubGlobal('fetch', espiao)

    await classificar(PERGUNTA, HOJE)

    const corpo = await corpoEnviado(espiao)
    expect(corpo).toEqual({
      model: MODELO,
      messages: [
        { role: 'system', content: promptClassificacao(HOJE) },
        { role: 'user', content: PERGUNTA },
      ],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      max_tokens: MAX_TOKENS_SAIDA,
      stream: false,
      temperature: 0,
    })

    // O que NAO pode aparecer em lugar nenhum do que sai do servidor: cookies,
    // ids, chaves, linhas de view e o nome de view nenhuma.
    for (const proibido of [
      'cookie',
      'Cookie',
      'reserva',
      'service_role',
      'SUPABASE',
      'select',
      'v_vendas_dia',
      'v_estoque',
      'v_mais',
      'Authorization',
    ]) {
      expect(String(JSON.stringify(corpo))).not.toContain(proibido)
    }
  })
})

// ============================================================
// Falhas: o que libera a reserva e o que a mantem.
// ============================================================

describe('falhas', () => {
  it('sem chave configurada e falha PRE-ENVIO: nao chama a rede', async () => {
    const espiao = espiaoDeFetch({})
    vi.stubGlobal('fetch', espiao)
    vi.stubEnv('DEEPSEEK_API_KEY', '')

    expect(await classificar(PERGUNTA, HOJE)).toEqual({ ok: false, fase: 'pre_envio' })
    expect(espiao).not.toHaveBeenCalled()
  })

  it('URL base invalida e falha PRE-ENVIO: nao chama a rede', async () => {
    const espiao = espiaoDeFetch({})
    vi.stubGlobal('fetch', espiao)
    vi.stubEnv('DEEPSEEK_BASE_URL', 'nao-e-uma-url')

    expect(await classificar(PERGUNTA, HOJE)).toEqual({ ok: false, fase: 'pre_envio' })
    expect(espiao).not.toHaveBeenCalled()
  })

  it('protocolo que nao e http(s) e falha PRE-ENVIO', async () => {
    const espiao = espiaoDeFetch({})
    vi.stubGlobal('fetch', espiao)
    vi.stubEnv('DEEPSEEK_BASE_URL', 'ftp://exemplo')

    expect(await classificar(PERGUNTA, HOJE)).toEqual({ ok: false, fase: 'pre_envio' })
    expect(espiao).not.toHaveBeenCalled()
  })

  it('5xx do provedor e falha AMBIGUA: o pedido pode ter sido faturado', async () => {
    vi.stubGlobal('fetch', espiaoDeFetch({ error: 'boom' }, false, 503))

    expect(await classificar(PERGUNTA, HOJE)).toEqual({ ok: false, fase: 'ambigua' })
  })

  // IMPORTANT 2 DA REVISAO FINAL. Um 4xx da lista e recusa ANTES de inferir: nada
  // foi faturado e a reserva volta. Sem isso, a chave errada queimava 1.373 µ$ por
  // pergunta e fechava o mes de US$ 5 sem UMA resposta.
  it('401 (chave invalida ou revogada) e falha PRE-ENVIO: nao houve inferencia', async () => {
    vi.stubGlobal('fetch', espiaoDeFetch({ error: 'invalid api key' }, false, 401))

    expect(await classificar(PERGUNTA, HOJE)).toEqual({ ok: false, fase: 'pre_envio' })
  })

  it('400, 402 e 403 tambem sao PRE-ENVIO (a lista fechada do gateway)', async () => {
    for (const status of [400, 402, 403]) {
      vi.stubGlobal('fetch', espiaoDeFetch({ error: 'recusado' }, false, status))

      expect(await classificar(PERGUNTA, HOJE), `status ${status}`).toEqual({
        ok: false,
        fase: 'pre_envio',
      })
    }
  })

  // O CONTROLE POSITIVO da correcao acima: se alguem trocar a lista por um
  // "libera todo 4xx", este teste quebra. 429 significa que a requisicao pode ter
  // sido aceita e contada — a retencao conservadora e o que a spec manda.
  it('429 e falha AMBIGUA: a distincao e uma lista, nao um "libera todo 4xx"', async () => {
    vi.stubGlobal('fetch', espiaoDeFetch({ error: 'rate limited' }, false, 429))

    expect(await classificar(PERGUNTA, HOJE)).toEqual({ ok: false, fase: 'ambigua' })
  })

  it('4xx fora da lista (408, 422) continua AMBIGUO', async () => {
    for (const status of [408, 422, 409]) {
      vi.stubGlobal('fetch', espiaoDeFetch({ error: 'outro 4xx' }, false, status))

      expect(await classificar(PERGUNTA, HOJE), `status ${status}`).toEqual({
        ok: false,
        fase: 'ambigua',
      })
    }
  })

  it('queda de conexao e timeout sao falhas AMBIGUAS', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    expect(await classificar(PERGUNTA, HOJE)).toEqual({ ok: false, fase: 'ambigua' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted', 'AbortError')
      }),
    )
    expect(await classificar(PERGUNTA, HOJE)).toEqual({ ok: false, fase: 'ambigua' })
  })

  it('corpo que nao e JSON e RECUSA normal, nao excecao', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('resposta nao era JSON')
          },
        } as unknown as Response
      }),
    )

    expect(await classificar(PERGUNTA, HOJE)).toEqual({ ok: true, conteudo: '', uso: null })
  })

  it('conteudo vazio, choices vazio ou sem usage viram a MESMA recusa normal', async () => {
    const corpos = [
      { choices: [{ message: { content: '' } }], usage: { prompt_tokens: 7, completion_tokens: 0 } },
      { choices: [{ message: { content: null } }], usage: { prompt_tokens: 7, completion_tokens: 0 } },
      { choices: [{ message: {} }], usage: { prompt_tokens: 7, completion_tokens: 0 } },
      { choices: [], usage: { prompt_tokens: 7, completion_tokens: 0 } },
      { choices: [{ message: { content: '{"intencao":"vendas_dia"}' } }] },
      {},
    ]

    for (const corpo of corpos) {
      const espiao = espiaoDeFetch(corpo)
      vi.stubGlobal('fetch', espiao)

      const resultado = await classificar(PERGUNTA, HOJE)
      expect(resultado.ok).toBe(true)
      if (resultado.ok) {
        expect(typeof resultado.conteudo).toBe('string')
      }
    }
  })

  it('sucesso devolve o conteudo e o usage CRUS, sem interpretar', async () => {
    const conteudo = '{"intencao":"estoque_baixo"}'
    const uso = { prompt_tokens: 123, completion_tokens: 9 }
    vi.stubGlobal('fetch', espiaoDeFetch({ choices: [{ message: { content: conteudo } }], usage: uso }))

    expect(await classificar(PERGUNTA, HOJE)).toEqual({ ok: true, conteudo, uso })
  })

  it('nao registra pergunta, resposta nem detalhe tecnico em log nenhum', async () => {
    const logs = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
    ]
    vi.stubGlobal('fetch', espiaoDeFetch({ choices: [{ message: { content: '{}' } }] }))

    await classificar(PERGUNTA, HOJE)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    await classificar(PERGUNTA, HOJE)

    for (const log of logs) expect(log).not.toHaveBeenCalled()
  })
})
