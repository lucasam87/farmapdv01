// O cerebro testavel do agente gerencial da etapa 8 — PURO: sem `fetch`, sem
// Supabase, sem React, sem relogio proprio.
//
// Tudo o que decide antes de gastar dinheiro mora aqui: o que o usuario pode
// perguntar, o que o modelo pode responder, quanto a chamada pode custar e como
// as quatro respostas sao escritas. A rota `POST /api/agente` (Tarefa 3) so
// orquestra: ela chama estas funcoes na ordem, consulta a view e nao reimplementa
// nenhuma regra que ja esteja neste arquivo.
//
// DUAS ARMADILHAS QUE ESTE MODULO EXISTE PARA EVITAR:
//   1. Recusar consulta gerencial legitima por causa da palavra "remedio". Os
//      substantivos do catalogo (remedio, medicamento, produto) NAO sao filtro: o
//      filtro clinico procura FRASE QUE PEDE CONSELHO ("o que posso tomar",
//      "qual a dosagem") ou sintoma com pergunta de ajuda. Ver `recusaLocal`.
//   2. `formatarData('2026-10-09')` devolve 08/10/2026. A coluna `dia` de
//      `v_vendas_dia` e um `date` do Postgres e chega como 'YYYY-MM-DD': a
//      meia-noite UTC cai no dia anterior em Sao Paulo (UTC-3). A data civil e
//      formatada aqui sem passar por `Date`. Ver `formatarDiaCivil`.

import { formatarMoeda } from '@/lib/format'
import { diaAnterior, validarDia } from '@/app/(app)/vendas/dia'

/** Tamanho maximo da pergunta, em caracteres. */
export const LIMITE_PERGUNTA = 500

/** Tamanho maximo do payload de mensagens, em bytes UTF-8. */
export const LIMITE_PAYLOAD_BYTES = 4096

/** Entrada de pico dimensionada na reserva: 4096 tokens. */
export const TOKENS_ENTRADA_RESERVA = 4096

/** Saida maxima da chamada: 120 tokens. */
export const MAX_TOKENS_SAIDA = 120

/** Unico modelo permitido ao agente. */
export const MODELO = 'deepseek-flash'

/** Teto do mes civil de Sao Paulo: US$ 5 em micros de dolar. */
export const TETO_MENSAL_MICROS = 5_000_000

/** Intervalo maximo de um periodo explicito, inclusive nas duas pontas. */
export const DIAS_MAXIMOS = 31

/** Linhas que a rota pede a view. */
export const LIMITE_RESULTADOS = 10

/** Tarifa de pico de entrada: US$ 0,30 por milhao de tokens, em micros. */
export const TARIFA_ENTRADA_MICROS_POR_MILHAO = 300_000

/** Tarifa de pico de saida: US$ 1,20 por milhao de tokens, em micros. */
export const TARIFA_SAIDA_MICROS_POR_MILHAO = 1_200_000

// A reserva e DERIVADA das tarifas e dos limites, nunca um literal solto: no dia
// em que a tabela de precos mudar, a reserva e o teto por chamada andam juntos e
// um unico teste fixa o numero (1373). Arredonda para CIMA porque subestimar a
// reserva furaria o teto do mes.
export const RESERVA_MICROS = Math.ceil(
  (TOKENS_ENTRADA_RESERVA * TARIFA_ENTRADA_MICROS_POR_MILHAO) / 1_000_000 +
    (MAX_TOKENS_SAIDA * TARIFA_SAIDA_MICROS_POR_MILHAO) / 1_000_000,
)

export type Intencao =
  | 'vendas_dia'
  | 'mais_vendidos'
  | 'estoque_baixo'
  | 'estoque_parado'
  | 'fora_escopo'

export type Classificacao =
  | { intencao: 'fora_escopo' }
  | { intencao: 'mais_vendidos' | 'estoque_baixo' | 'estoque_parado'; limite: number }
  | { intencao: 'vendas_dia'; de: string; ate: string }

export type MotivoRecusa = 'vazia' | 'longa' | 'payload' | 'clinica' | 'pessoal' | 'classificacao'

export type DadosResposta =
  | {
      intencao: 'vendas_dia'
      linhas: { dia: string; quantidade: number; total: number; ticket_medio: number }[]
    }
  | { intencao: 'mais_vendidos'; linhas: { nome: string; quantidade: number }[] }
  | {
      intencao: 'estoque_baixo' | 'estoque_parado'
      linhas: { nome: string; estoque_atual: number }[]
    }

// ============================================================
// Textos ao usuario — em portugues, sempre. Valores em centavos chegam prontos
// das views e so viram texto aqui, por `lib/format.ts`.
// ============================================================

const MENSAGENS_RECUSA: Record<MotivoRecusa, string> = {
  vazia: 'Escreva uma pergunta sobre vendas ou estoque da farmacia.',
  longa: `A pergunta pode ter no maximo ${LIMITE_PERGUNTA} caracteres.`,
  payload: 'A pergunta ficou grande demais para ser enviada. Tente encurtar.',
  clinica:
    'Nao posso dar orientacao de saude nem indicar remedio, dose ou tratamento. ' +
    'Procure um medico ou farmaceutico. Posso ajudar com vendas e estoque.',
  pessoal:
    'Remova CPF, telefone e e-mail da pergunta. O assistente nao precisa de dados ' +
    'pessoais para responder sobre vendas e estoque.',
  classificacao:
    'Nao entendi a pergunta. Tente reformular com vendas, produtos mais vendidos, ' +
    'estoque baixo ou produtos parados.',
}

const VAZIO_VENDAS = 'Nao ha vendas registradas no periodo consultado.'
const VAZIO_MAIS_VENDIDOS = 'Ainda nao ha produtos vendidos registrados.'
const VAZIO_ESTOQUE_BAIXO = 'Nenhum produto precisa de reposicao no momento.'
const VAZIO_ESTOQUE_PARADO = 'Nenhum produto esta parado no momento.'

/** Texto fixo em portugues para cada motivo de recusa. */
export function mensagemRecusa(motivo: MotivoRecusa): string {
  return MENSAGENS_RECUSA[motivo]
}

/**
 * Formata um `date` do Postgres ('YYYY-MM-DD') como 'DD/MM/AAAA' SEM passar por
 * `Date`. Usar `formatarData` aqui devolveria o dia anterior: a string vira
 * meia-noite UTC e o formatador converte para Sao Paulo (UTC-3), recuando um dia.
 */
function formatarDiaCivil(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split('-')
  if (ano === undefined || mes === undefined || diaDoMes === undefined) return dia
  return `${diaDoMes}/${mes}/${ano}`
}

function listaVazia(dados: DadosResposta): string {
  switch (dados.intencao) {
    case 'vendas_dia':
      return VAZIO_VENDAS
    case 'mais_vendidos':
      return VAZIO_MAIS_VENDIDOS
    case 'estoque_baixo':
      return VAZIO_ESTOQUE_BAIXO
    case 'estoque_parado':
      return VAZIO_ESTOQUE_PARADO
  }
}

/**
 * Monta a resposta final a partir de dados que vieram da view — o modelo nunca
 * escreve este texto. Dinheiro entra em CENTAVOS e sai por `formatarMoeda`.
 */
export function montarResposta(dados: DadosResposta): string {
  if (dados.linhas.length === 0) return listaVazia(dados)

  switch (dados.intencao) {
    case 'vendas_dia': {
      let quantidade = 0
      let total = 0
      const linhas = dados.linhas.map((linha) => {
        quantidade += linha.quantidade
        total += linha.total
        return (
          `${formatarDiaCivil(linha.dia)}: ${linha.quantidade} ` +
          `${linha.quantidade === 1 ? 'venda' : 'vendas'}, ` +
          `${formatarMoeda(linha.total)} de total, ` +
          `ticket medio de ${formatarMoeda(linha.ticket_medio)}`
        )
      })

      return [
        'Vendas por dia',
        ...linhas,
        `Total: ${quantidade} ${quantidade === 1 ? 'venda' : 'vendas'} e ${formatarMoeda(total)}`,
      ].join('\n')
    }

    case 'mais_vendidos':
      return [
        'Produtos mais vendidos',
        ...dados.linhas.map(
          (linha, i) => `${i + 1}. ${linha.nome}: ${linha.quantidade} unidades`,
        ),
      ].join('\n')

    case 'estoque_baixo':
      return [
        'Produtos com estoque baixo',
        ...dados.linhas.map((linha) => `${linha.nome}: ${linha.estoque_atual} em estoque`),
      ].join('\n')

    case 'estoque_parado':
      return [
        'Produtos parados',
        ...dados.linhas.map((linha) => `${linha.nome}: ${linha.estoque_atual} em estoque`),
      ].join('\n')
  }
}

// ============================================================
// Triagem local — roda ANTES de qualquer chamada externa e antes de qualquer
// consulta a view. Nada aqui e gravado em log nem em banco.
// ============================================================

// Frase que PEDE CONSELHO de saude. E o gatilho do filtro clinico quando o texto
// nao descreve sintoma nenhum: "qual a dosagem", "posso tomar".
//
// NAO existe alternativa por substantivo de produto ("qual remedio...") AQUI, de
// proposito: "Qual remedio vendeu mais no mes passado?" e consulta gerencial
// legitima, e "qual remedio e bom para pressao alta?" ja e pega por
// SITUACAO_CLINICA + PEDIDO_SOBRE_SITUACAO. Foi justamente um filtro por
// substantivo que reprovou a primeira versao deste arquivo.
//
// SEM `\b` em volta do grupo inteiro: `\b` depois de uma alternativa que termina
// em espaco nunca casa, porque a posicao seguinte e uma letra. As alternativas
// curtas levam o proprio `\b` na ponta.
const PEDIDO_DE_CONSELHO =
  /(o que (eu )?(posso|devo) (tomar|dar|fazer)|posso (tomar|dar)\b|qual a dosagem|qual a dose|quanto (eu )?(posso|devo) tomar\b|me ajuda\b|o que eu fa[çc]o|preciso tomar|devo tomar|faz mal|pode tomar\b)/i

// Situacao clinica (sintoma ou doenca). Recusa junto de um pedido de conselho ou
// de ajuda — sozinha, "febre" pode ser nome de produto ou relato gerencial, e
// recusar por causa dela seria falso positivo.
const SITUACAO_CLINICA =
  /\b(dor(es)?( de (cabe[çc]a|barriga|garganta|dente|costas|ouvido))?|febre|press[ãa]o alta|press[ãa]o baixa|diabet|infec[çc][ãa]o|inflama[çc][ãa]o|alergia|gripe|resfriado|tosse|diarreia|v[oô]mito|n[aá]usea|queimadura|c[oó]lica|ansiedade|ins[oô]nia|gravidez|gr[áa]vida|gestante|amamenta)\b/i

// Como se pergunta sobre um sintoma: e isto, junto da situacao clinica, que
// separa "qual remedio e bom para pressao alta?" (clinico) de "quais medicamentos
// estao parados?" (gerencial).
//
// O verbo de conselho e OBRIGATORIO nas duas formas. Sem ele, "qual remedio
// vendeu mais?" (gerencial) casaria por causa do substantivo — foi esse o falso
// positivo que reprovou a primeira versao do filtro.
const PEDIDO_SOBRE_SITUACAO =
  /([eé] bom\b|serve para\b|[eé] indicado\b|posso tomar\b|posso dar\b|tomar\b|rem[eé]dio para\b|qual (o )?(rem[eé]dio|medicament|antibiotic|xarope|pomada|analg[eé]sico|antibi[oó]tico)[^?]*\b([eé] bom|posso|serve|indica|tomo|tomar|pra|para)\b)/i

const PEDIDO_DE_AJUDA = /(o que (eu )?(posso|devo)|me ajuda\b|o que eu fa[çc]o|posso dar\b|[eé] grave\b|preciso fazer)/i

// CPF com ou sem pontuacao (11 digitos). O `\b` no fim impede casar um numero
// maior por acidente.
const CPF_COM_PONTOS = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/
const CPF_SEM_PONTOS = /\b\d{11}\b/

// Telefone brasileiro COM DDD e o nono digito: (11) 98765-4321 / 11 98765-4321.
// Os separadores sao obrigatorios, e por isso que '01/01/2026' NAO casa: uma
// data nao tem um bloco de 4 ou 5 digitos depois do primeiro separador.
const TELEFONE = /(?:\+?55[\s-]?)?(?:\(\d{2}\)|\b\d{2})[\s.-]?\d{4,5}[\s.-]?\d{4}\b/

const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/

function recusaClinica(pergunta: string): boolean {
  // (a) frase que pede conselho, mesmo sem descrever sintoma nenhum.
  if (PEDIDO_DE_CONSELHO.test(pergunta)) return true
  if (!SITUACAO_CLINICA.test(pergunta)) return false
  // (b) sintoma + "e bom para isso?" / "posso tomar?" / "o que eu faco?".
  // (c) "meu filho" sozinho NAO recusa: pode ser nome de cadastro. O que recusa e
  // o preparo para medicar alguem.
  return PEDIDO_SOBRE_SITUACAO.test(pergunta) || PEDIDO_DE_AJUDA.test(pergunta)
}

function recusaPessoal(pergunta: string): boolean {
  if (EMAIL.test(pergunta)) return true
  if (CPF_COM_PONTOS.test(pergunta)) return true
  if (CPF_SEM_PONTOS.test(pergunta)) return true
  return TELEFONE.test(pergunta)
}

/**
 * Triagem local de saude e de dado pessoal. Devolve o motivo quando o texto tem
 * que ser recusado sem chamada externa e sem consulta a view, ou `null` quando a
 * pergunta pode seguir. A clinica tem prioridade sobre o pessoal: a orientacao de
 * saude e a mensagem mais importante das duas.
 */
export function recusaLocal(pergunta: string): 'clinica' | 'pessoal' | null {
  if (typeof pergunta !== 'string') return null
  if (recusaClinica(pergunta)) return 'clinica'
  if (recusaPessoal(pergunta)) return 'pessoal'
  return null
}

/** Bytes UTF-8 do texto. `TextEncoder` e nativo no servidor e no teste. */
function bytesUtf8(texto: string): number {
  return new TextEncoder().encode(texto).length
}

/**
 * Caracteres visiveis, contados por CODE POINT. `String.length` conta unidades
 * UTF-16: um emoji vale 2 e um usuario que digitasse 400 deles veria "800
 * caracteres" sendo recusado por um limite de 500. Contar code point e o que o
 * usuario entende por caractere.
 */
function contarCaracteres(texto: string): number {
  return Array.from(texto).length
}

/**
 * Valida e apara a pergunta ANTES de qualquer efeito: tamanho, payload e a
 * triagem local de saude/PII. A ordem importa — nao gastamos regex de saude num
 * texto que nem cabe no pedido.
 */
export function validarPergunta(bruto: unknown): { ok: true; pergunta: string } | { ok: false; motivo: MotivoRecusa } {
  if (typeof bruto !== 'string') return { ok: false, motivo: 'vazia' }

  const pergunta = bruto.trim()
  if (pergunta === '') return { ok: false, motivo: 'vazia' }
  if (contarCaracteres(pergunta) > LIMITE_PERGUNTA) return { ok: false, motivo: 'longa' }
  if (bytesUtf8(pergunta) > LIMITE_PAYLOAD_BYTES) return { ok: false, motivo: 'payload' }

  const local = recusaLocal(pergunta)
  if (local !== null) return { ok: false, motivo: local }

  return { ok: true, pergunta }
}

// ============================================================
// Validacao ESTRITA do JSON do classificador. Qualquer coisa fora do contrato
// vira `null` (recusa) — nunca uma interpretacao "mais ou menos".
// ============================================================

const CHAVES_ACEITAS = ['intencao', 'de', 'ate', 'limite'] as const

const INTENCOES: readonly Intencao[] = [
  'vendas_dia',
  'mais_vendidos',
  'estoque_baixo',
  'estoque_parado',
  'fora_escopo',
]

/** Aceita ausente ou nulo; qualquer outra coisa e um valor presente. */
function presente(valor: unknown): boolean {
  return valor !== undefined && valor !== null
}

function lerData(valor: unknown, hoje: string): string | null {
  const dia = validarDia(valor as string, hoje)
  return dia.aviso ? null : dia.dia
}

function diasInclusivos(de: string, ate: string): number {
  let dias = 1
  let cursor = ate
  while (cursor !== de) {
    cursor = diaAnterior(cursor)
    dias += 1
  }
  return dias
}

function validarLimite(valor: unknown): number | null {
  if (!presente(valor)) return LIMITE_RESULTADOS
  if (typeof valor !== 'number') return null
  if (!Number.isInteger(valor)) return null
  if (valor < 1 || valor > LIMITE_RESULTADOS) return null
  return valor
}

function validarVendasDia(objeto: Record<string, unknown>, hoje: string): Classificacao | null {
  const temDe = presente(objeto.de)
  const temAte = presente(objeto.ate)

  // Nenhuma das pontas: a pergunta e "hoje", e hoje e a data injetada — o
  // modulo nao olha o relogio.
  if (!temDe && !temAte) return { intencao: 'vendas_dia', de: hoje, ate: hoje }

  // Uma ponta so e ambigua: recusa em vez de chutar a outra.
  if (!temDe || !temAte) return null

  const de = lerData(objeto.de, hoje)
  const ate = lerData(objeto.ate, hoje)
  if (de === null || ate === null) return null
  if (de > ate) return null
  if (diasInclusivos(de, ate) > DIAS_MAXIMOS) return null

  return { intencao: 'vendas_dia', de, ate }
}

function validarSemPeriodo(
  chave: 'mais_vendidos' | 'estoque_baixo' | 'estoque_parado',
  objeto: Record<string, unknown>,
): Classificacao | null {
  // As tres views nao filtram data: periodo aqui e `fora_escopo` de verdade, e
  // fingir que filtra seria mentir para o dono.
  if (presente(objeto.de) || presente(objeto.ate)) return null

  const limite = validarLimite(objeto.limite)
  if (limite === null) return null

  return { intencao: chave, limite }
}

/**
 * Valida a classificacao que o modelo devolveu. `bruto` pode chegar como objeto
 * ja parseado OU como a string de conteudo do modelo (a rota entrega o que veio).
 * `hoje` e a data de Sao Paulo em 'YYYY-MM-DD', injetada para o teste nao depender
 * do relogio. `null` significa RECUSA: chave a mais, intencao fora do enum, data
 * inexistente, intervalo invertido, maior que `DIAS_MAXIMOS`, uma ponta so, ou
 * periodo onde a view nao filtra.
 */
export function validarClassificacao(bruto: unknown, hoje: string): Classificacao | null {
  let objeto: unknown = bruto

  if (typeof bruto === 'string') {
    try {
      objeto = JSON.parse(bruto)
    } catch {
      return null
    }
  }

  if (typeof objeto !== 'object' || objeto === null || Array.isArray(objeto)) return null

  const registro = objeto as Record<string, unknown>
  // Qualquer chave alem das quatro do contrato invalida a resposta inteira.
  if (Object.keys(registro).some((chave) => !(CHAVES_ACEITAS as readonly string[]).includes(chave))) {
    return null
  }

  const intencao = registro.intencao
  if (typeof intencao !== 'string' || !(INTENCOES as readonly string[]).includes(intencao)) return null

  switch (intencao as Intencao) {
    case 'fora_escopo':
      return { intencao: 'fora_escopo' }
    case 'vendas_dia':
      return validarVendasDia(registro, hoje)
    case 'mais_vendidos':
    case 'estoque_baixo':
    case 'estoque_parado':
      return validarSemPeriodo(intencao as 'mais_vendidos' | 'estoque_baixo' | 'estoque_parado', registro)
  }
}

// ============================================================
// Dinheiro da chamada paga — micros de dolar em INTEIROS.
// ============================================================

/**
 * Custo real da chamada em micros de dolar, com as tarifas de pico. Arredonda
 * para CIMA: subcobrar deixaria o consumido do mes menor do que a fatura e o teto
 * furaria. `uso` ausente ou nulo devolve 0; manter ou liberar a reserva nesse caso
 * e decisao da rota (Tarefa 3), nao deste modulo.
 */
export function custoMicros(uso: { prompt_tokens: number; completion_tokens: number } | null | undefined): number {
  if (uso === null || uso === undefined) return 0

  const entrada = uso.prompt_tokens * TARIFA_ENTRADA_MICROS_POR_MILHAO
  const saida = uso.completion_tokens * TARIFA_SAIDA_MICROS_POR_MILHAO
  return Math.ceil((entrada + saida) / 1_000_000)
}

// ============================================================
// Mes civil de Sao Paulo — o `p_mes` que a rota passa para a RPC do orcamento.
// ============================================================

const ANO_MES_SAO_PAULO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
})

/**
 * O primeiro dia do mes civil de Sao Paulo de `agora`, em 'YYYY-MM-01'. E o
 * `p_mes` que a RPC do orcamento exige (a funcao do banco recusa um dia que nao
 * seja o primeiro do mes). O fuso e explicito: as 22h30 de 31/10 em Sao Paulo ja
 * sao 01/11 em UTC, e o mes tem que ser o de quem esta no balcao.
 */
export function mesSaoPaulo(agora: Date): string {
  const ano = ANO_MES_SAO_PAULO.formatToParts(agora).find((parte) => parte.type === 'year')?.value
  const mes = ANO_MES_SAO_PAULO.formatToParts(agora).find((parte) => parte.type === 'month')?.value
  return `${ano}-${mes}-01`
}
