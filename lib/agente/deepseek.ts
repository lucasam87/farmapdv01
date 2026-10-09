import 'server-only'
import { MAX_TOKENS_SAIDA, MODELO } from '@/app/(app)/agente/logica'

// O UNICO lugar do sistema que fala com o DeepSeek — e o unico que tem o direito
// de conhecer `DEEPSEEK_API_KEY`. Fica marcado como `server-only`: o Next
// implementa esse import no proprio compilador, entao qualquer tentativa de
// importar este modulo de um componente cliente quebra o build, em vez de vazar
// a chave para o bundle.
//
// O que este modulo NAO faz, de proposito:
//   - nao monta resposta para o usuario (quem monta e `logica.ts`);
//   - nao valida a classificacao (quem valida e `orquestracao.ts`);
//   - nao registra nada em log. Nem a pergunta, nem o corpo da resposta, nem o
//     erro do provedor. A regra do plano e literal: nunca registrar pergunta,
//     resposta, prompt, cookie, chave ou detalhe tecnico.
//
// O QUE SAI DAQUI E SOMENTE O PROMPT FIXO E A PERGUNTA. Nada de linha de view,
// id, cookie ou chave no corpo. Ha teste afirmando o objeto enviado inteiro.

/** Tempo maximo esperando o provedor, contado do envio ate o corpo chegar. */
export const TIMEOUT_MS = 10_000

/**
 * Prompt FIXO de classificacao. Duas exigencias da doc oficial do JSON Output
 * entram aqui, e nao sao estilo: (a) a palavra "json" tem que aparecer no
 * prompt, e (b) o formato desejado tem que vir com um EXEMPLO LITERAL. Sem as
 * duas, `response_format: json_object` nao ativa o modo JSON de verdade.
 *
 * A descricao usa "AAAA-MM-DD" em vez de "YYYY-MM-DD" porque o texto esta em
 * portugues; o formato que o modelo devolve e o mesmo 'YYYY-MM-DD' que
 * `validarClassificacao` exige (e que `logica.test.ts` fixa).
 */
export const PROMPT_CLASSIFICACAO =
  'Voce classifica uma pergunta de gestao de farmacia em UMA das consultas permitidas.\n' +
  'Responda SOMENTE com um objeto json, sem texto antes ou depois.\n' +
  'Exemplo do formato exato: {"intencao": "vendas_dia", "de": null, "ate": null, "limite": null}\n' +
  '\n' +
  '"intencao" tem que ser exatamente uma destas cinco:\n' +
  '- "vendas_dia": vendas por dia. "de" e "ate" aceitam "AAAA-MM-DD"; use null nas duas para hoje. ' +
  'O periodo tem no maximo 31 dias. "limite" sempre null.\n' +
  '- "mais_vendidos": produtos mais vendidos. "de" e "ate" sempre null. "limite" de 1 a 10, ou null para 10.\n' +
  '- "estoque_baixo": produtos que precisam de reposicao. "de" e "ate" sempre null. ' +
  '"limite" de 1 a 10, ou null para 10.\n' +
  '- "estoque_parado": produtos sem venda recente. "de" e "ate" sempre null. ' +
  '"limite" de 1 a 10, ou null para 10.\n' +
  '- "fora_escopo": qualquer outra pergunta, inclusive pedido de conselho de saude, ' +
  'diagnostico, remedio, dose ou tratamento. Nesse caso "de", "ate" e "limite" sao null.\n' +
  '\n' +
  'Use somente essas quatro chaves. Nunca responda com outra intencao.'

/**
 * Resultado de uma classificacao. `ok: true` NAO quer dizer "classificacao
 * valida": quer dizer "o provedor respondeu". O conteudo pode vir vazio (a doc
 * do modo JSON avisa que a API devolve conteudo vazio de vez em quando) e o
 * `uso` pode vir ausente — quem decide se isso e recusa ou custo e a
 * orquestracao, nao este modulo.
 *
 * A falha tem DUAS fases, e a diferenca vale dinheiro:
 *   - `pre_envio`: deu para provar que nada saiu (chave ausente, URL invalida).
 *     A reserva pode ser liberada.
 *   - `ambigua`: o pedido pode ter saido e ter sido faturado (timeout, queda de
 *     conexao, 5xx). A reserva fica consumida ate o fim do mes.
 */
export type ResultadoClassificacao =
  | { ok: true; conteudo: string; uso: unknown }
  | { ok: false; fase: 'pre_envio' | 'ambigua' }

type Mensagem = { role: 'system' | 'user'; content: string }

function bytesUtf8(texto: string): number {
  return new TextEncoder().encode(texto).length
}

/** As duas mensagens enviadas, nesta ordem: prompt fixo e pergunta. */
export function mensagensDeClassificacao(pergunta: string): Mensagem[] {
  return [
    { role: 'system', content: PROMPT_CLASSIFICACAO },
    { role: 'user', content: pergunta },
  ]
}

/**
 * Bytes UTF-8 do payload REAL de mensagens (prompt fixo + pergunta).
 *
 * O limite de 4.096 bytes do plano tem que ser medido sobre o que realmente vai
 * sair daqui, e nao so sobre a pergunta: sozinha, a pergunta e limitada a 500
 * caracteres (no pior caso 2.000 bytes) e nunca chegaria perto do teto, o que
 * faria da checagem uma linha morta. Com o prompt somado, a conta e a do pedido
 * de verdade.
 */
export function bytesDoPayload(pergunta: string): number {
  return mensagensDeClassificacao(pergunta).reduce(
    (total, mensagem) => total + bytesUtf8(mensagem.content),
    0,
  )
}

function baseUrl(): string {
  const configurada = process.env.DEEPSEEK_BASE_URL?.trim()
  // Vazia conta como ausente: e o que um `.env` com a chave em branco produz.
  return configurada !== undefined && configurada !== ''
    ? configurada
    : 'https://api.deepseek.com'
}

function chaveDaApi(): string | null {
  const chave = process.env.DEEPSEEK_API_KEY?.trim()
  return chave !== undefined && chave !== '' ? chave : null
}

function campo(objeto: unknown, nome: string): unknown {
  if (typeof objeto !== 'object' || objeto === null) return undefined
  return (objeto as Record<string, unknown>)[nome]
}

/** `choices[0].message.content` como string; vazio ou ausente vira ''. */
function lerConteudo(corpo: unknown): string {
  const escolhas = campo(corpo, 'choices')
  if (!Array.isArray(escolhas) || escolhas.length === 0) return ''
  const conteudo = campo(campo(escolhas[0], 'message'), 'content')
  return typeof conteudo === 'string' ? conteudo : ''
}

/**
 * Classifica a pergunta. Nao lanca: toda falha vira `{ ok: false, fase }`, para a
 * orquestracao decidir o destino da reserva sem `try/catch` no meio do fluxo.
 *
 * A fronteira pre-envio/ambigua e deliberadamente CONSERVADORA: so e pre-envio o
 * que da para provar que nao saiu (chave ausente, URL que nem monta, protocolo
 * que nao e http). Timeout, queda de conexao e 5xx sao ambiguos, porque o
 * provedor pode ter recebido e faturado o pedido.
 */
export async function classificar(pergunta: string): Promise<ResultadoClassificacao> {
  const chave = chaveDaApi()
  if (chave === null) return { ok: false, fase: 'pre_envio' }

  let destino: URL
  try {
    destino = new URL('/chat/completions', baseUrl())
  } catch {
    return { ok: false, fase: 'pre_envio' }
  }

  if (destino.protocol !== 'https:' && destino.protocol !== 'http:') {
    return { ok: false, fase: 'pre_envio' }
  }

  const corpo = {
    model: MODELO,
    messages: mensagensDeClassificacao(pergunta),
    response_format: { type: 'json_object' },
    // R12 — o `deepseek-flash` LIGA o thinking mode por padrao, com effort high,
    // e devolve `reasoning_content` antes do `content`. Com 120 tokens de saida,
    // o raciocinio consumiria o teto inteiro antes de sair qualquer json.
    // Desligado, `temperature` volta a valer (em thinking mode ela e ignorada em
    // silencio pela API).
    thinking: { type: 'disabled' },
    max_tokens: MAX_TOKENS_SAIDA,
    stream: false,
    temperature: 0,
  }

  let resposta: Response
  try {
    resposta = await fetch(destino, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${chave}`,
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // Timeout, conexao recusada, DNS: nao ha como provar que o pedido nao chegou.
    return { ok: false, fase: 'ambigua' }
  }

  if (!resposta.ok) return { ok: false, fase: 'ambigua' }

  let corpoResposta: unknown
  try {
    corpoResposta = await resposta.json()
  } catch {
    // 200 com corpo que nao e JSON. Os tokens foram gastos: devolve o mesmo
    // "recusa normal" de conteudo vazio, com uso ausente (a orquestracao mantem
    // a reserva porque o custo e desconhecido).
    return { ok: true, conteudo: '', uso: null }
  }

  return { ok: true, conteudo: lerConteudo(corpoResposta), uso: campo(corpoResposta, 'usage') ?? null }
}
