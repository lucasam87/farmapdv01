import {
  LIMITE_PAYLOAD_BYTES,
  MAX_TOKENS_SAIDA,
  RESERVA_MICROS,
  TOKENS_ENTRADA_RESERVA,
  custoMicros,
  mensagemRecusa,
  mesSaoPaulo,
  montarResposta,
  respostaFinanceiro,
  validarAssunto,
  validarClassificacao,
  validarConsultaFinanceiro,
  validarPergunta,
  type Assunto,
  type ConsultaFinanceiroValidada,
  type DadosFinanceiro,
  type DadosResposta,
} from '@/app/(app)/agente/logica'
import { bytesDoPayload, type ResultadoClassificacao } from '@/lib/agente/deepseek'
import type { Perfil } from '@/lib/auth/perfil'

// O contrato do provedor e reexportado daqui de proposito: quem consome a
// orquestracao (a rota, os testes e as tarefas 4/5) importa tudo o que precisa
// de UM lugar so, sem precisar conhecer `lib/agente/deepseek.ts`.
export type { ResultadoClassificacao } from '@/lib/agente/deepseek'

// A ORQUESTRACAO da rota `POST /api/agente`: a ordem inteira do fluxo, do portao
// de entrada ate o texto que o usuario le. Tudo o que toca o mundo (relogio,
// provedor, ledger, view) entra por INJECAO aqui, entao este arquivo e testavel
// sem Next, sem rede e sem banco — e a rota (Tarefa 4/5) fica sendo so um
// adaptador.
//
// Este modulo NAO importa `next/*`, nao chama `fetch` e nao conhece Supabase: as
// unicas importacoes de fora sao a logica pura (`logica.ts`), o formato do
// payload do provedor (`deepseek.ts`) e o tipo do perfil.
//
// A ORDEM e a defesa:
//   1. sessao e perfil ativo, ANTES de qualquer custo externo;
//   2. validacao da pergunta e triagem local (nao reserva nada);
//   3. reserva do teto por chamada no ledger;
//   4. classificacao no provedor;
//   5. validacao estrita do JSON devolvido;
//   6. UMA consulta, na view da intencao, com o cliente da sessao;
//   7. resposta montada por codigo, nunca o texto do modelo.

export type Entrada = {
  /** Sessao Supabase valida. E o que separa o 401 do 403. */
  sessao: boolean
  /** Perfil ativo do usuario, ou `null` quando a sessao nao tem perfil. */
  perfil: Perfil | null
  /** Corpo cru da requisicao: quem valida e `validarPergunta`. */
  pergunta: unknown
}

/** As cinco intencoes que consultam o banco. `fora_escopo` nao consulta nada. */
export type IntencaoConsulta =
  | 'vendas_dia'
  | 'mais_vendidos'
  | 'estoque_baixo'
  | 'estoque_parado'
  | 'margem_produto'

/** Periodo explicito da consulta de vendas/margem; `null` nas views que nao filtram data. */
export type FiltroConsulta = { de: string; ate: string } | null

/** Uma linha crua da view. A conversao para `DadosResposta` e feita aqui. */
export type LinhaConsulta = Record<string, unknown>

/**
 * `semCusto` so existe na margem: e a contagem de `margem_sem_custo` (produtos que
 * ficaram fora do ranking). Ausente nas demais intencoes.
 */
export type ResultadoConsulta =
  | { ok: true; linhas: LinhaConsulta[]; semCusto?: number }
  | { ok: false }

export type ResultadoReserva = { ok: true; id: string } | { ok: false; motivo: 'esgotado' | 'falha' }

/** O que a rota devolve: `NextResponse.json(corpo, { status })`. */
export type RespostaProcessada = {
  status: number
  corpo: { resposta: string } | { erro: string }
}

/**
 * As seis dependencias externas, todas injetadas (R17). Os nomes sao os das
 * RPCs do ledger e das views do banco:
 *   - `classificar`: `lib/agente/deepseek.ts` (unico `fetch` do sistema);
 *   - `reservar`/`reconciliar`/`liberar`: `lib/supabase/privilegiado.ts`;
 *   - `consultar`: a view permitida, sempre pelo cliente da SESSAO;
 *   - `agora`: relogio injetado (mes e "hoje" saem do MESMO instante).
 *
 * `limite` e `null` para vendas_dia de proposito: o periodo e de no maximo 31
 * dias e a view devolve uma linha por dia, entao cortar em 10 faria o total do
 * periodo virar um total PARCIAL apresentado como total. O teto de vendas_dia e
 * o proprio intervalo validado.
 */
export type Deps = {
  agora(): Date
  /**
   * `hoje` e a data de Sao Paulo do MESMO instante de `agora()`. Ela vai no prompt
   * porque o modelo nao sabe que dia e — sem isso ele chuta a data e o servidor
   * responde sobre o dia chutado (achado de 14/10/2026).
   */
  classificar(pergunta: string, hoje: string): Promise<ResultadoClassificacao>
  /**
   * As DUAS chamadas do grafo. Sao **opcionais de proposito**: sem elas a
   * orquestracao segue exatamente o caminho de uma chamada so, com a reserva de
   * sempre — entao ligar o grafo e uma **ativacao explicita**, e nao um
   * comportamento novo que aparece sozinho quando alguem mexer na rota.
   */
  classificarAssunto?(pergunta: string, hoje: string): Promise<ResultadoClassificacao>
  classificarFinanceiro?(pergunta: string, hoje: string): Promise<ResultadoClassificacao>
  /**
   * Recebe a consulta JA VALIDADA e devolve os dados JA no formato do montador,
   * para que a orquestracao nao precise conhecer `relatorio_resumo`,
   * `relatorio_lucro` nem `relatorio_formas_pagamento` — quem conhece e a rota.
   */
  consultarFinanceiro?(consulta: ConsultaFinanceiroValidada): Promise<DadosFinanceiro | null>
  reservar(mes: string, micros: number): Promise<ResultadoReserva>
  reconciliar(id: string, micros: number): Promise<void>
  liberar(id: string): Promise<void>
  consultar(
    intencao: IntencaoConsulta,
    filtro: FiltroConsulta,
    limite: number | null,
  ): Promise<ResultadoConsulta>
}

// Mensagens curtas em portugues. Nenhuma delas carrega detalhe tecnico, chave,
// prompt ou linha de banco, e nenhuma e registrada em log.
// A de 401 e usada nos DOIS casos de `sessao: false` — sem sessao nenhuma E
// excecao de Auth/`cookies()` tratada como "sem sessao" na rota (Minor 1) —, entao
// ela nao pode afirmar que o usuario esta deslogado: se o Auth caiu e ele estava
// logado, "faca login" seria falso. "Nao foi possivel confirmar sua sessao" e
// verdadeiro nos dois casos. O status continua 401 (fail closed).
const MENSAGEM_SEM_SESSAO = 'Não foi possível confirmar sua sessão. Entre novamente.'
const MENSAGEM_SEM_PERFIL = 'Seu perfil não tem acesso ao assistente.'
const MENSAGEM_ORCAMENTO =
  'O limite mensal do assistente foi atingido. Tente novamente no próximo mês.'
const MENSAGEM_PROVEDOR = 'O assistente está indisponível agora. Tente novamente em instantes.'
const MENSAGEM_LEDGER = 'Não foi possível iniciar a consulta agora. Tente novamente em instantes.'
const MENSAGEM_SO_DONO = 'Só o dono vê o lucro.'
const MENSAGEM_LEITURA ='Não foi possível ler os dados agora. Tente novamente em instantes.'

const PAPEIS_PERMITIDOS: readonly string[] = ['dono', 'atendente']

// Triagem local para o atendente: palavras que so o dono pode perguntar.
const PERGUNTA_DE_LUCRO = /\b(margem|margens|lucro|lucros|lucratividade|custo|custos)\b/

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function erro(mensagem: string): { erro: string } {
  return { erro: mensagem }
}

/**
 * Soma os custos das chamadas feitas NESTA pergunta.
 *
 * ⚠️ **Nunca reconciliar duas vezes na mesma reserva.** `reconciliar` SUBSTITUI o
 * valor reservado pelo custo real: duas chamadas reconciliadas em separado
 * substituiriam uma a outra em vez de somar, e o mes pagaria por uma so.
 *
 * `null` em QUALQUER parcela significa custo DESCONHECIDO e derruba o total para
 * `null` — a mesma regra conservadora de `custoDaChamada`: reserva que ficou
 * consumida e melhor que reserva liberada sobre tokens que podem ter sido
 * faturados. Com UMA parcela a funcao devolve exatamente o que `custoDaChamada`
 * devolveria, entao o caminho sem grafo nao muda de comportamento.
 */
function somaDeCustos(custos: (number | null)[]): number | null {
  let total = 0
  for (const custo of custos) {
    if (custo === null) return null
    total += custo
  }
  return total
}

/**
 * Fecha a reserva quando a chamada SEGUINTE falhou em `pre_envio`.
 *
 * ⚠️ ACHADO DA REVISAO INDEPENDENTE (Important 1 de 16/10/2026): aqui **nao se pode
 * `liberar`**. Com o grafo ligado o coordenador **ja respondeu e ja foi cobrado**;
 * `liberar` devolveria a reserva INTEIRA e o teto do mes passaria a medir MENOS do
 * que a farmacia gastou.
 *
 *   - custo do coordenador CONHECIDO -> reconcilia com ele: o mes paga o que gastou;
 *   - custo DESCONHECIDO -> nao se mexe na reserva e ela fica **consumida** (a regra
 *     conservadora: custo desconhecido nunca vira credito).
 *
 * Quem chama so entra aqui quando o coordenador RODOU. Quando nao rodou, nada saiu e
 * o certo continua sendo `liberarEmSilencio`.
 */
async function liquidarEmSilencio(deps: Deps, id: string, custoJaGasto: number | null): Promise<void> {
  if (custoJaGasto === null) return
  await reconciliarEmSilencio(deps, id, custoJaGasto)
}

/**
 * Custo real da chamada em micros, ou `null` quando nao da para confiar no
 * `usage`. ESTA E A FRONTEIRA DO DINHEIRO: `custoMicros` (logica.ts) multiplica o
 * que receber e um `usage` torto (campo ausente, string, negativo, NaN, 1e15)
 * devolveria NaN ou micros negativos — e micros negativos CREDITARIAM o mes,
 * furando o teto por baixo. Só passa daqui inteiro finito nao-negativo.
 *
 * O teto de tokens de cada campo nao e decoracao: e o mesmo dimensionamento da
 * reserva (`TOKENS_ENTRADA_RESERVA` e `MAX_TOKENS_SAIDA`). Tokens nunca sao mais
 * numerosos que os bytes do payload (4.096, o limite do R17) e a saida esta
 * travada em 120 pelo `max_tokens`, entao um `usage` acima disso nao pode ser de
 * uma chamada real — e um numero absurdo que passaria a consumir o mes inteiro
 * por causa de um corpo corrompido. Tratado como custo desconhecido (a reserva
 * fica), nunca como custo.
 */
export function custoDaChamada(uso: unknown): number | null {
  if (typeof uso !== 'object' || uso === null) return null

  const registro = uso as Record<string, unknown>
  const entrada = registro.prompt_tokens
  const saida = registro.completion_tokens
  if (!tokenValido(entrada, TOKENS_ENTRADA_RESERVA)) return null
  if (!tokenValido(saida, MAX_TOKENS_SAIDA)) return null

  const micros = custoMicros({ prompt_tokens: entrada, completion_tokens: saida })
  if (!Number.isSafeInteger(micros) || micros < 0) return null
  return micros
}

function tokenValido(valor: unknown, teto: number): valor is number {
  return (
    typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0 && valor <= teto
  )
}

// O "hoje" de Sao Paulo para validar o periodo do modelo. `mesSaoPaulo` (logica)
// so devolve o mes do orcamento; o formato 'YYYY-MM-DD' de `en-CA` e o mesmo que
// `validarClassificacao` espera, e o fuso e explicito pelo mesmo motivo.
const DIA_SAO_PAULO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function diaSaoPaulo(agora: Date): string {
  return DIA_SAO_PAULO.format(agora)
}

// ============================================================
// Conversao dos dados da view para a resposta. A view devolve `Record`
// generico; `montarResposta` espera tipos exatos. Nada aqui pode virar NaN.
// ============================================================

function numero(valor: unknown): number {
  const convertido = typeof valor === 'number' ? valor : Number(valor)
  return Number.isFinite(convertido) ? convertido : 0
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : ''
}

function montarDados(
  intencao: IntencaoConsulta,
  linhas: LinhaConsulta[],
  semCusto: number,
  periodo: FiltroConsulta,
): DadosResposta {
  switch (intencao) {
    case 'margem_produto':
      // `numero` aceita number e string numerica (PostgREST manda `numeric` como
      // string); o que nao for finito vira 0, nunca NaN na tela.
      return {
        intencao: 'margem_produto',
        produtos: linhas.map((linha) => ({
          nome: texto(linha.nome),
          receita: numero(linha.receita),
          custo: numero(linha.custo),
          margem: numero(linha.margem),
        })),
        semCusto,
        ...(periodo === null ? {} : { periodo }),
      }
    case 'vendas_dia':
      return {
        intencao: 'vendas_dia',
        linhas: linhas.map((linha) => ({
          dia: texto(linha.dia),
          quantidade: numero(linha.quantidade),
          total: numero(linha.total),
          ticket_medio: numero(linha.ticket_medio),
        })),
      }
    case 'mais_vendidos':
      return {
        intencao: 'mais_vendidos',
        linhas: linhas.map((linha) => ({
          nome: texto(linha.nome),
          quantidade: numero(linha.quantidade),
        })),
      }
    case 'estoque_baixo':
    case 'estoque_parado':
      return {
        intencao,
        linhas: linhas.map((linha) => ({
          nome: texto(linha.nome),
          estoque_atual: numero(linha.estoque_atual),
        })),
      }
  }
}

// O ledger e melhor esforco DEPOIS de a resposta existir: uma falha ao
// reconciliar deixa a reserva maxima consumida (o lado conservador) e NAO pode
// derrubar um resultado que o usuario ja pagou.
async function reconciliarEmSilencio(deps: Deps, id: string, micros: number): Promise<void> {
  try {
    await deps.reconciliar(id, micros)
  } catch {
    // Sem log: detalhe tecnico nao vai para lugar nenhum.
  }
}

async function liberarEmSilencio(deps: Deps, id: string): Promise<void> {
  try {
    await deps.liberar(id)
  } catch {
    // Se a liberacao falhar, a reserva fica consumida — nunca pior que o custo real.
  }
}

/**
 * O fluxo inteiro, na ordem. Devolve `{ status, corpo }`: a rota so embrulha em
 * `NextResponse.json`. Nunca lanca — toda falha tem um status e uma mensagem
 * curta em portugues.
 */
export async function processarPergunta(
  entrada: Entrada,
  deps: Deps,
): Promise<RespostaProcessada> {
  // 1. Quem esta perguntando. Sem sessao ou sem perfil ativo nada externo roda:
  //    nem provedor, nem ledger.
  if (!entrada.sessao) return { status: 401, corpo: erro(MENSAGEM_SEM_SESSAO) }

  const perfil = entrada.perfil
  if (perfil === null || !PAPEIS_PERMITIDOS.includes(perfil.papel)) {
    return { status: 403, corpo: erro(MENSAGEM_SEM_PERFIL) }
  }

  // 2. Entrada e triagem local: clinica e dado pessoal reconhecido morrem AQUI,
  //    sem reserva e sem envio.
  const validada = validarPergunta(entrada.pergunta)
  if (!validada.ok) return { status: 400, corpo: erro(mensagemRecusa(validada.motivo)) }
  const pergunta = validada.pergunta

  // 2b. Atendente perguntando de margem/lucro/custo: recusa LOCAL, antes da reserva
  //     e do provedor (mesmo tratamento da pergunta clinica). Sem isto o atendente
  //     gastaria orcamento para ouvir um "nao". A checagem pos-classificacao (5b)
  //     fica como segunda barreira para o que a triagem nao pegar.
  if (perfil.papel !== 'dono' && PERGUNTA_DE_LUCRO.test(semAcento(pergunta))) {
    return { status: 403, corpo: erro(MENSAGEM_SO_DONO) }
  }

  // O limite de 4.096 bytes vale para o payload REAL (prompt do sistema + pergunta),
  // nao so para a pergunta — que sozinha nunca chegaria perto do teto.
  //
  // ⚠️ GUARDA DE FRONTEIRA, INALCANCAVEL COM O LIMITE ATUAL (Minor 8 da revisao
  // final): o pior caso medido e o prompt (1.016 bytes, mais a linha da data) + 500
  // code points de 4 bytes, e `validarPergunta` ja recusou acima de 500 code points.
  // Ou seja, `motivo: 'payload'` nao dispara por uma pergunta valida. A guarda fica
  // porque ela mede o que REALMENTE sai (`bytesDoPayload`), e o dia em que o prompt
  // crescer quem tem que segurar o teto e esta linha — o numero esta fixado em
  // `logica.test.ts` e em `lib/agente/deepseek.test.ts`.
  //
  // O relogio e lido UMA vez, e aqui: o mes do orcamento, a data que vai no prompt e
  // a validacao do periodo tem de sair do MESMO instante. Duas leituras poderiam
  // discordar na virada do dia.
  const agora = deps.agora()
  const hoje = diaSaoPaulo(agora)

  if (bytesDoPayload(pergunta, hoje) > LIMITE_PAYLOAD_BYTES) {
    return { status: 400, corpo: erro(mensagemRecusa('payload')) }
  }

  // 3. Reserva ANTES de falar com o provedor. O mes e o de Sao Paulo e sempre o
  //    primeiro dia: a RPC do banco recusa qualquer outro valor.
  const mes = mesSaoPaulo(agora)

  // O grafo so roda com as TRES dependencias ligadas. A reserva DOBRA quando ele
  // roda, porque a pergunta passa a gastar duas chamadas: o coordenador e (o
  // especialista OU o classificador de hoje, no ramo de assunto ainda nao ligado).
  // Sem as dependencias, isto e `false` e nada abaixo muda.
  const grafo =
    deps.classificarAssunto !== undefined &&
    deps.classificarFinanceiro !== undefined &&
    deps.consultarFinanceiro !== undefined

  let reserva: ResultadoReserva
  try {
    reserva = await deps.reservar(mes, grafo ? RESERVA_MICROS * 2 : RESERVA_MICROS)
  } catch {
    reserva = { ok: false, motivo: 'falha' }
  }

  if (!reserva.ok) {
    return reserva.motivo === 'esgotado'
      ? { status: 429, corpo: erro(MENSAGEM_ORCAMENTO) }
      : { status: 502, corpo: erro(MENSAGEM_LEDGER) }
  }

  // 4. O GRAFO, quando ligado: o COORDENADOR escolhe o especialista (chamada 1).
  let custoDoCoordenador: number | null = null
  let assunto: Assunto | null = null
  // ⚠️ `custoDoCoordenador === null` tem DOIS significados — "nao rodou, nada foi
  // gasto" e "rodou com `usage` desconhecido, gastou um valor que nao se sabe". Este
  // sinal separa os dois: e ele que decide entre `liberar` e `liquidar` quando a
  // chamada seguinte falha em `pre_envio` (Important 1 da revisao).
  let coordenadorRodou = false

  if (grafo && deps.classificarAssunto !== undefined) {
    let primeira: ResultadoClassificacao
    try {
      primeira = await deps.classificarAssunto(pergunta, hoje)
    } catch {
      primeira = { ok: false, fase: 'ambigua' }
    }

    if (!primeira.ok) {
      if (primeira.fase === 'pre_envio') await liberarEmSilencio(deps, reserva.id)
      return { status: 502, corpo: erro(MENSAGEM_PROVEDOR) }
    }

    custoDoCoordenador = custoDaChamada(primeira.uso)
    coordenadorRodou = true
    assunto = validarAssunto(primeira.conteudo)

    // `fora_escopo` e um veredito LEGITIMO do coordenador — nao ha especialista
    // para esta pergunta. Gastar a segunda chamada para o classificador de hoje
    // so repetiria a decisao: aqui a recusa sai com UMA chamada, e a reserva e
    // reconciliada pelo custo dela (nunca liberada: o provedor ja respondeu).
    if (assunto === 'fora_escopo') {
      const custo = somaDeCustos([custoDoCoordenador])
      if (custo !== null) await reconciliarEmSilencio(deps, reserva.id, custo)
      return { status: 400, corpo: erro(mensagemRecusa('classificacao')) }
    }
  }

  // 4a. Especialista LIGADO — hoje so o de Vendas e financeiro. A chamada 2 escolhe
  //     a consulta e o periodo, e o texto e montado em CODIGO: o modelo nao escreve
  //     numero nenhum, nem aqui nem no coordenador.
  //
  //     Qualquer outro assunto NAO entra neste bloco: ele desce para o caminho de
  //     hoje, logo abaixo, que ja funciona. E o que impede os quatro especialistas
  //     ainda nao ligados de regredirem.
  if (
    assunto === 'financeiro' &&
    deps.classificarFinanceiro !== undefined &&
    deps.consultarFinanceiro !== undefined
  ) {
    let segunda: ResultadoClassificacao
    try {
      segunda = await deps.classificarFinanceiro(pergunta, hoje)
    } catch {
      segunda = { ok: false, fase: 'ambigua' }
    }

    if (!segunda.ok) {
      // `pre_envio` prova que ESTA chamada nao saiu — mas o coordenador JA foi
      // cobrado. Liberar aqui devolveria a reserva inteira. Ver `liquidarEmSilencio`.
      if (segunda.fase === 'pre_envio') await liquidarEmSilencio(deps, reserva.id, custoDoCoordenador)
      return { status: 502, corpo: erro(MENSAGEM_PROVEDOR) }
    }

    // UMA reconciliacao, com a SOMA das duas chamadas. Ver `somaDeCustos`.
    const custo = somaDeCustos([custoDoCoordenador, custoDaChamada(segunda.uso)])
    if (custo !== null) await reconciliarEmSilencio(deps, reserva.id, custo)

    const validada = validarConsultaFinanceiro(segunda.conteudo, hoje)
    if (!validada.ok) {
      // A recusa por TAMANHO tem mensagem propria e honesta: o pedido foi entendido
      // e as datas sao reais — o que nao cabe e o periodo. Dizer "nao entendi" ali
      // faria o dono reformular a pergunta inteira e falhar de novo do mesmo jeito,
      // porque a recusa e deterministica.
      return {
        status: 400,
        corpo: erro(mensagemRecusa(validada.motivo === 'periodo' ? 'periodo' : 'classificacao')),
      }
    }

    const consulta = validada.consulta

    // O lucro e do dono. A recusa sai ANTES de a rota ler qualquer dado — o banco
    // tambem recusa (a funcao e `security definer` e checa o papel), mas aqui nao
    // se le nada.
    if (consulta.consulta === 'lucro' && perfil.papel !== 'dono') {
      return { status: 403, corpo: erro(MENSAGEM_SO_DONO) }
    }

    let dados: DadosFinanceiro | null
    try {
      dados = await deps.consultarFinanceiro(consulta)
    } catch {
      dados = null
    }

    if (dados === null) return { status: 500, corpo: erro(MENSAGEM_LEITURA) }

    return { status: 200, corpo: { resposta: respostaFinanceiro(dados) } }
  }

  // 4. Classificacao no provedor.
  let classificacao: ResultadoClassificacao
  try {
    classificacao = await deps.classificar(pergunta, hoje)
  } catch {
    // Excecao inesperada tem o mesmo tratamento da falha ambigua: o pedido pode
    // ter saido e sido faturado, entao a reserva fica consumida.
    classificacao = { ok: false, fase: 'ambigua' }
  }

  if (!classificacao.ok) {
    // Pre-envio prova que nao saiu. Se o grafo rodou, esta e a SEGUNDA chamada da
    // reserva e o coordenador ja foi cobrado: liquidar o que se gastou, nunca
    // liberar tudo (Important 1 da revisao). Sem grafo, nada saiu e a reserva volta.
    if (classificacao.fase === 'pre_envio') {
      if (coordenadorRodou) await liquidarEmSilencio(deps, reserva.id, custoDoCoordenador)
      else await liberarEmSilencio(deps, reserva.id)
    }
    return { status: 502, corpo: erro(MENSAGEM_PROVEDOR) }
  }

  // 4b. O provedor respondeu: reconcilia pelo `usage` quando ele e confiavel. Se
  //     nao houver `usage` (ou ele vier torto), a reserva fica consumida — o
  //     custo e desconhecido e liberar abriria espaco que pode ter sido faturado.
  //     Isso vale TAMBEM quando o conteudo veio vazio ou invalido: os tokens
  //     foram gastos do mesmo jeito.
  // Quando o grafo rodou e o assunto caiu no caminho de hoje, esta e a SEGUNDA
  // chamada da MESMA reserva: a reconciliacao leva a SOMA, nunca duas chamadas a
  // `reconciliar` (a segunda substituiria a primeira e o mes pagaria por uma so).
  const custo = grafo
    ? somaDeCustos([custoDoCoordenador, custoDaChamada(classificacao.uso)])
    : custoDaChamada(classificacao.uso)
  if (custo !== null) await reconciliarEmSilencio(deps, reserva.id, custo)

  // 5. Validacao ESTRITA do que o modelo devolveu. Qualquer coisa fora do
  //    contrato (chave a mais, intencao desconhecida, data torta, periodo
  //    invertido ou maior que 31 dias) e recusa, nunca consulta.
  const classificada = validarClassificacao(classificacao.conteudo, hoje)
  if (classificada === null || classificada.intencao === 'fora_escopo') {
    return { status: 400, corpo: erro(mensagemRecusa('classificacao')) }
  }

  // 5b. Margem e custo sao do dono. O banco tambem recusa (a funcao e `security
  //     definer` e checa o papel), mas aqui a recusa sai antes de a rota ler.
  if (classificada.intencao === 'margem_produto' && perfil.papel !== 'dono') {
    return { status: 403, corpo: erro(MENSAGEM_SO_DONO) }
  }

  // 6. UMA consulta, na view da intencao, com o cliente da sessao.
  const filtro: FiltroConsulta =
    classificada.intencao === 'vendas_dia' || classificada.intencao === 'margem_produto'
      ? { de: classificada.de, ate: classificada.ate }
      : null
  // Vendas por dia nao leva limite: 31 dias e o teto do periodo, e cortar em 10
  // faria o "Total" virar um total parcial.
  const limite = classificada.intencao === 'vendas_dia' ? null : classificada.limite

  let leitura: ResultadoConsulta
  try {
    leitura = await deps.consultar(classificada.intencao, filtro, limite)
  } catch {
    leitura = { ok: false }
  }

  if (!leitura.ok) return { status: 500, corpo: erro(MENSAGEM_LEITURA) }

  // 7. A resposta e SO o texto montado por codigo a partir da view. A saida do
  //    modelo (o JSON de classificacao) nunca chega ao usuario.
  return {
    status: 200,
    corpo: { resposta: montarResposta(montarDados(classificada.intencao, leitura.linhas, leitura.semCusto ?? 0, filtro)) },
  }
}
