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
//
// POR QUE UM 4xx NAO PODE TER SIDO FATURADO (a correcao do Important 2 da revisao
// final). O provedor e pago por INFERENCIA, e a inferencia so comeca depois de o
// gateway aceitar a requisicao. 400 (requisicao invalida), 401/403 (chave ausente,
// invalida ou revogada) e 402 (saldo insuficiente) sao recusados ANTES de qualquer
// token ser processado — nao existiu inferencia, logo nao existe o que faturar.
// Marca-los como `ambigua` retinha 1.373 µ$ por tentativa: com a chave errada
// (colagem com erro de digitacao, chave revogada), ~3.641 perguntas fechavam o mes
// de US$ 5 sem produzir UMA resposta, e o agente passaria a dizer "limite mensal
// atingido" mesmo depois de a chave ser corrigida.
//
// O QUE CONTINUA AMBIGUO, e e a spec que manda: 429 (rate limit pode ter aceitado
// e contado a requisicao), 5xx, timeout e falha de rede. Ali a retencao
// conservadora e exatamente o que a spec quer ("se o custo for desconhecido, a
// reserva maxima permanece consumida"). A fronteira e uma lista fechada, nao um
// "libera todo 4xx": ha teste para o 401 (pre-envio) E para o 429 (ambiguo).

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
 *   - `pre_envio`: deu para provar que nada saiu (chave ausente, URL invalida) OU
 *     que o provedor recusou a requisicao antes de inferir (400/401/402/403). A
 *     reserva pode ser liberada.
 *   - `ambigua`: o pedido pode ter saido e ter sido faturado (timeout, queda de
 *     conexao, 429, 5xx). A reserva fica consumida ate o fim do mes.
 */
export type ResultadoClassificacao =
  | { ok: true; conteudo: string; uso: unknown }
  | { ok: false; fase: 'pre_envio' | 'ambigua' }

type Mensagem = { role: 'system' | 'user'; content: string }

function bytesUtf8(texto: string): number {
  return new TextEncoder().encode(texto).length
}

/**
 * O prompt de sistema COM a data de hoje.
 *
 * Achado de 14/10/2026: o prompt fixo pedia `null` em "de"/"ate" para "hoje" e nunca
 * dizia que dia era hoje — entao o modelo chutava uma data, e o servidor respondia
 * sobre o dia chutado. Foi medido em producao: a MESMA pergunta ("como foram as
 * vendas de hoje?") respondeu o dia 13 numa execucao e "nao ha vendas" na outra.
 *
 * A data NAO vem do relogio deste modulo: ela entra por parametro, do mesmo
 * `agora()` injetado que decide o mes do orcamento e valida o periodo. Duas fontes
 * de relogio poderiam discordar na virada do dia.
 */
export function promptClassificacao(hoje: string): string {
  return (
    PROMPT_CLASSIFICACAO +
    '\n' +
    '\n' +
    `Hoje e ${hoje} (fuso de America/Sao_Paulo). Use null em "de" e "ate" quando a ` +
    'pergunta for sobre hoje ou nao citar data; quando o usuario citar um dia ou um ' +
    'periodo, converta para o formato "AAAA-MM-DD" usando esta data como referencia ' +
    '(ontem, esta semana, mes passado). Nunca devolva data no futuro.'
  )
}

/** As duas mensagens enviadas, nesta ordem: prompt do sistema e pergunta. */
export function mensagensDeClassificacao(pergunta: string, hoje: string): Mensagem[] {
  return [
    { role: 'system', content: promptClassificacao(hoje) },
    { role: 'user', content: pergunta },
  ]
}

/**
 * Bytes UTF-8 do payload REAL de mensagens (prompt do sistema + pergunta).
 *
 * O limite de 4.096 bytes do plano tem que ser medido sobre o que realmente vai
 * sair daqui, e nao so sobre a pergunta: sozinha, a pergunta e limitada a 500
 * caracteres (no pior caso 2.000 bytes) e nunca chegaria perto do teto, o que
 * faria da checagem uma linha morta. Com o prompt somado, a conta e a do pedido
 * de verdade — e a data, que tem sempre 10 caracteres, nao muda o tamanho.
 */
export function bytesDoPayload(pergunta: string, hoje: string): number {
  return mensagensDeClassificacao(pergunta, hoje).reduce(
    (total, mensagem) => total + bytesUtf8(mensagem.content),
    0,
  )
}

function baseUrl(): string {
  // Em PRODUCAO o destino e cravado. `DEEPSEEK_BASE_URL` existe para o teste
  // apontar a rota para um stub local (ruling R3), e so. Se ela existisse tambem
  // no ambiente de producao, o `Authorization: Bearer <DEEPSEEK_API_KEY>` inteiro
  // iria para o host que ela apontasse: uma variavel de ambiente errada, ou
  // definida por engano, mandaria a chave para fora. Em producao ela e ignorada.
  if (process.env.NODE_ENV === 'production') return 'https://api.deepseek.com'

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
 * que da para provar que nao saiu ou que nao houve inferencia (chave ausente, URL
 * que nem monta, protocolo que nao e http, 400/401/402/403 — ver o cabecalho).
 * Timeout, queda de conexao, 429 e 5xx sao ambiguos, porque o provedor pode ter
 * recebido e faturado o pedido.
 */
export async function classificar(pergunta: string, hoje: string): Promise<ResultadoClassificacao> {
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
    messages: mensagensDeClassificacao(pergunta, hoje),
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

  // O gateway recusa 400/401/402/403 ANTES de inferir: nada foi processado, logo
  // nada foi faturado, e a reserva pode voltar. A lista e FECHADA de proposito —
  // 429 e qualquer outro 4xx (408, 409, 422) continuam ambiguos, porque ali o
  // pedido pode ter sido aceito e contado. Ver o cabecalho do modulo.
  if (!resposta.ok) {
    const recusadoAntesDeInferir =
      resposta.status === 400 ||
      resposta.status === 401 ||
      resposta.status === 402 ||
      resposta.status === 403
    return { ok: false, fase: recusadoAntesDeInferir ? 'pre_envio' : 'ambigua' }
  }

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
