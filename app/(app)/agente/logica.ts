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
import { validarDia } from '@/app/(app)/vendas/dia'

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

// ARMADILHA DE `\b` EM PORTUGUES — a correcao do Important 1 e de um falso
// negativo que ela revelou. `\b` no JavaScript e ASCII: nao existe fronteira
// antes de "a" de "alergia" nem depois de "r" de "tomar" quando o que segue e o
// "a" acentuado de "tomar a decisao"... na pratica `\b` se comporta ao CONTRARIO
// do que o filtro precisa nas duas pontas. Tentar compensar com `(?![a-zà-ú])` em
// cada alternativa e piorar o problema: sao ~30 posicoes que precisam concordar.
//
// A solucao e tirar o acento do TEXTO antes de testar (`semAcento`) e escrever as
// regex com ASCII puro. Depois disso `\b` volta a ser fronteira de palavra de
// verdade. Os padroes abaixo sao todos SEM acento de proposito: nao "conserte"
// acrescentando [eé] ou [ãa], porque o texto que chega aqui ja esta sem acento.
const SEM_ACENTOS: Record<string, string> = {
  á: 'a', à: 'a', ã: 'a', â: 'a', ä: 'a',
  é: 'e', ê: 'e', è: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', õ: 'o', ô: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ç: 'c', ñ: 'n',
}

function semAcento(texto: string): string {
  return texto.toLowerCase().replace(/[^\x00-\x7F]/g, (letra) => SEM_ACENTOS[letra] ?? letra)
}

// GATILHO ABSOLUTO: pedido explicito de dose, de escolha ou de uso de
// medicamento. Sozinho ja recusa, porque nao existe leitura gerencial de
// "qual a dosagem de amoxicilina".
//
// O pedido de CONSELHO e obrigatorio na alternativa do medicamento ([e] bom,
// serve, indica, posso, melhor, pra, para). Sem ele, "qual remedio vendeu mais no
// mes passado?" (gerencial) casaria por causa do substantivo — foi o falso
// positivo que reprovou a primeira versao do filtro. `[^?]*` limita o salto a
// mesma frase, entao "qual remedio vendeu? serve para X" nao casa por engano.
const GATILHO_CLINICO_DIRETO =
  /(qual a (dosagem|dose|posologia)|quanto (eu )?(posso|devo) tomar\b|quantas gotas|quantos comprimidos|o que (eu )?(posso |devo )?tomar\b|o que (eu )?(posso|devo) dar\b|qual (o )?(melhor )?(remedio|medicamento|medicament|antibiotico|xarope|pomada|analgesico)[^?]*\b(e bom|serve|indica|posso|e melhor|melhor|pra|para)\b)/i

// SITUACAO CLINICA: sintoma ou doenca. Usada para reconhecer a pergunta do tipo
// "e bom para isso?" / "serve para isso?" sem exigir o nome do medicamento.
const SITUACAO_CLINICA =
  /\b(dor(es)?( de (cabeca|barriga|garganta|dente|costas|ouvido))?|febre|pressao (alta|baixa)|diabet|infec[c]ao|inflamac[a]o|alergia|gripe|resfriado|tosse|diarreia|vomito|nausea|queimadura|colica|ansiedade|insonia|gravidez|gravida|gestante|amamenta)\b/i

const MEDICACAO =
  /\b(remedio|medicamento|medicament|antibiotico|amoxicilina|dipirona|paracetamol|ibuprofeno|loratadina|analgesico|xarope|pomada|dose|dosagem|posologia|comprimido|capsula|gotas)\b/i

// ANCORA CLINICA: o texto fala de sintoma, doenca ou medicamento. NAO recusa
// sozinha — substantivo de catalogo nao e pedido de conselho ("quais medicamentos
// estao parados?", "qual remedio vendeu mais?"). Ela so vale acompanhada de um
// PEDIDO.
const ANCORA_CLINICA = new RegExp(`${SITUACAO_CLINICA.source}|${MEDICACAO.source}`, 'i')

// PEDIDO DE AJUDA ou de conselho — GENERICO de portugues. NAO recusa sozinho:
// "me ajuda a ver as vendas de hoje", "o que eu faco para repor o estoque?",
// "posso dar desconto?" e "devo tomar cuidado com o estoque?" sao perguntas
// gerenciais legitimas. A classe inteira e o Achado Important 1 da revisao.
//
// TOMAR/DAR ESTAO AQUI DE VOLTA (fix round 3). O round 2 os tirou para fechar o
// furo do "dar baixa na febre" e, junto, perdeu o verbo no FIM de frase
// ("Estou com febre, posso tomar?"), que a base recusava — o criterio deste round
// e nao regredir contra a base, entao a lista volta a ser a da base. Quem decide
// se o pedido e de negocio e o crivo OBJETO_DE_NEGOCIO_NAO_CLINICO, nao a
// ausencia do verbo.
//
// A palavra "medicamento" tambem e PROIBIDA nas alternativas deste padrao:
// qualquer `me ajuda` que a contivesse viraria recusa clinica. Quem cobre a
// variante "me ajuda a escolher um medicamento para pressao alta" e o portao de
// ANCORA_CLINICA.
const PEDIDO_DE_AJUDA =
  /(o que (eu )?(posso|devo)( fazer)?|posso (da|tomo|tomar)\b|preciso (tomar|da)\b|devo (tomar|da)\b|me ajuda\b|o que eu faco|faz mal\b|pode (tomar|dar)\b|e grave\b|quem pode tomar\b)/i

// O UNICO crivo de negocio do filtro clinico: reconhece o pedido como de negocio
// somente quando o objeto ligado ao pedido e CLARAMENTE de gestao E nao ha
// NENHUMA ancora clinica na frase. Basta a frase citar um medicamento, uma dose
// ou um sintoma para o crivo NAO valer, e o pedido cair no caminho clinico.
//
// A direcao da escolha e deliberada. Um objeto de negocio citado de passagem, com
// assunto de saude em qualquer lugar da frase, e pergunta de SAUDE ("uma olhada no
// relatorio da dose de amoxicilina"), e nao gestao. A ancora clinica pode estar
// longe do objeto — por isso o crivo inteiro e envolvido por um lookahead negativo
// de ancora, e nao so o complemento imediato.
//
//   "posso dar baixa no estoque vencido"          -> negocio, segue
//   "posso dar baixa na febre do meu filho"       -> clinico (assunto clinico)
//   "posso dar uma olhada no relatorio de vendas" -> negocio, segue
//   "posso dar uma olhada na dose da amoxicilina" -> clinico (assunto clinico)
//   "uma olhada na dose de xarope"                -> o crivo nao fecha em "olhada"
//                                                    + "o relatorio" no meio
const OBJETO_DE_NEGOCIO_NAO_CLINICO = new RegExp(
  // O `^` NAO e enfeite: sem ele o lookahead de ancora so e testado na posicao em
  // que o match comeca, e o motor simplesmente comeca DEPOIS do assunto clinico —
  // `(?![\s\S]*X)` sem ancora e VERDADEIRO mesmo com X no texto. Ancorado, o
  // lookahead e sempre avaliado da posicao 0 e ve a frase inteira. Foi esse detalhe
  // que deixou tres casos escapando mesmo com a ancora "varrendo tudo".
  `^(?![\s\S]*(?:${ANCORA_CLINICA.source}))` +
    `\\b(baixa|desconto|entrada|jeito|olhada|providencia|medida|decisao|atitude|cuidado|avaliacao|checada|vista|parte|suporte|feedback|atencao|jeitinho)\\b` +
    // A ponte e so artigo/preposicao ("uma olhada NO relatorio", "dar entrada DE
    // mercadoria") — nunca "qualquer token". Com `(?:\s+\S+){0,3}` o crivo engolia
    // modificador + assunto clinico ("medida EXATA DE xarope" e "providencia
    // CORRETA PARA A febre") e classificava SAUDE como negocio.
    `(?:\\s+(?:a|as|o|os|um|uma|no|na|nos|nas|de|do|da|dos|das|em|num|numa|pelo|pela|com|sobre|para|pra)){0,2}` +
    `\\s+(?:estoque|nota|fiscal|mercadoria|produto|produtos|relatorio|vendas|sistema|caixa|pedido|compra|planilha|fornecedor|cliente|clientes|preco|margem|conta|contas|financeiro)\\b`,
  'i',
)

// SEM lookahead de ancora aqui de proposito: este padrao existe justamente para
// reconhecer um assunto CLINICO depois do objeto de gestao, e um
// `^(?![\s\S]*ANCORA)` bloquearia todo caso que ele deve pegar (todos tem assunto
// clinico por definicao). O portao de ancora ja foi checado antes desta regra.
const OBJETO_SOBRE_SAUDE = new RegExp(
  `\\b(olhada|medida|providencia|decisao|jeito)\\b` +
    `(?:\\s+\\S+){0,4}` +
    `\\s+(?:dose|dosagem|posologia|remedio|medicamento|xarope|comprimido|gotas|(?:dor|febre|tosse|gripe|infec[c]ao|inflamac[a]ao|alergia|crianca|bebe|filho|filha|gestante)\\b)`,
  'i',
)

// Pedido que so faz sentido medicando alguem: "posso dar dipirona para meu filho",
// "preciso tomar antibiotico". Exige a ancora clinica (o portao de cima).
//
// O verbo exige um complemento: e ele que separa "dar baixa" (objeto) de
// "dar dipirona" (medicamento). Quem tira o "dar baixa" do caminho clinico e o
// crivo de negocio, nao este padrao.
const PEDIDO_DE_MEDICAR =
  /((posso|devo|preciso|poderia|consigo|da|daria) (tomar|dar|da)\s+(?!uma\b)\S|quem pode tomar\b)/i

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
  // Os padroes sao ASCII e o `\b` so e fronteira de palavra de verdade sem
  // acento: quem tira o acento e esta linha, uma vez por pergunta.
  const texto = semAcento(pergunta)

  // (a) dose ou escolha de medicamento: sozinho ja e conselho de saude.
  if (GATILHO_CLINICO_DIRETO.test(texto)) return true

  // (a2) "entrada" com destino hospitalar SO e saude quando nao ha NADA de negocio
  // na frase. "entrada no hospital" (assistencia) e clinico; "nota do hospital",
  // "pedido do hospital", "mercadoria da clinica", "valor de entrada da clinica"
  // sao negocio — a instituicao ali e o EMITENTE ou o destino do lancamento, nao a
  // pessoa atendida. Fica antes do portao de ancora porque "entrada" sozinha nao e
  // ancora clinica e o caso seria inalcancavel depois dele.
  const DESTINO_HOSPITALAR =
    /\b(?:entrada|entrada de|dar entrada|registrar entrada|lan[c]ar entrada)\b(?:\s+\S+){0,3}\s+(?:hospital|emergencia|pronto[- ]socorro|upa|ubs|posto de saude|maternidade|clinica)\b/i
  const CONTEXTO_DE_NEGOCIO =
    /\b(?:nota|mercadoria|estoque|sistema|pedido|valor|planilha|caixa|fornecedor|lancar|registrar|cadastr\w*|comprovante|fatura|nf|nfe)\b/i
  if (DESTINO_HOSPITALAR.test(texto) && !CONTEXTO_DE_NEGOCIO.test(texto)) return true

  // Sem ancora clinica nao ha conselho de saude nenhum: "me ajuda a ver as
  // vendas", "o que eu faco para repor o estoque?" e "posso dar desconto?" sao
  // gerenciais e SEGUEM. Este portao e o que corrige o Important 1.
  if (!ANCORA_CLINICA.test(texto)) return false

  // CRIVO DE NEGOCIO: o pedido e de negocio quando o alvo ligado ao pedido e um
  // objeto de gestao E nao ha nenhuma ancora clinica na frase. So aqui o texto
  // escapa do filtro clinico — e so por este caminho estreito, para nao recusar
  // consulta gerencial legitima. Um objeto de negocio citado de passagem, com
  // assunto de saude em qualquer posicao, NAO passa por aqui.
  if (OBJETO_DE_NEGOCIO_NAO_CLINICO.test(texto)) return false

  // (b) um pedido de gestao que na verdade tem assunto de SAUDE como alvo
  // ("uma olhada na dose de xarope", "a providencia correta para a febre"): e
  // clinico, e o crivo acima nao o pega porque o que vem depois nao e objeto de
  // negocio.
  if (OBJETO_SOBRE_SAUDE.test(texto)) return true

  // (b2) assunto de saude a poucas palavras DEPOIS de um "olhada": "uma olhada no
  // relatorio DA DOSE DE AMOXICILINA", "uma olhada no sistema DA DOSE DO REMEDIO".
  // A janela e contada a partir do objeto (e nao da frase) de proposito: e o que
  // separa este caso de "uma olhada no relatorio de vendas de hoje" (que nao tem
  // assunto clinico nenhum na janela).
  if (/\bolhada\b(?:\s+\S+){0,9}\s+(?:dose|dosagem|posologia|remedio|medicamento|amoxicilina|dipirona|xarope|comprimido|gotas|febre|dor|tosse|infec[c]ao)\b/i.test(texto)) {
    return true
  }

  // (b) ancora clinica + pedido de conselho/ajuda. TOMAR/DAR entram aqui: e o que
  // pega o verbo no FIM de frase ("Estou com febre, posso tomar?"), que a base
  // recusava e o round 2 tinha perdido.
  if (PEDIDO_DE_AJUDA.test(texto)) return true

  // (c1) o verbo DAR/TOMAR com um pedido de gestao que nao e generico
  // ("dar uma olhada"): o crivo acima ja recusou os objetos de negocio puros, entao
  // o que sobrou com esses verbos e saude.
  if (/\b(dar|tomar|da)\s+(?!uma\b)\S/i.test(texto) && /(olhada|jeito)/i.test(texto)) return true

  // (c2) "baixar/baixa" + sintoma: "como dar baixa na pressao alta". Aqui "baixa"
  // nao e operacao de estoque, e sim o ato de reduzir o sintoma.
  if (/\bbaixa(?:r)?\b(?:\s+\S+){0,3}\s+(?:pressao|febre|dor|glicose|colesterol|peso)\b/i.test(texto)) return true

  // (c) a forma "posso dar/tomar <objeto>", que pede um complemento depois do
  // verbo. Exige a ancora clinica (o portao de cima).
  if (PEDIDO_DE_MEDICAR.test(texto)) return true

  // (d) ancora clinica + "e bom para isso?", "serve para isso?", "funciona?".
  if (/(e bom\b|serve para\b|e indicado\b|funciona\b|posso usar\b|pode dar\b|pode tomar\b)/i.test(texto)) return true

  const temSintoma = SITUACAO_CLINICA.test(texto)
  return temSintoma && PEDIDO_DE_AJUDA.test(texto)
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

const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * Le uma data do JSON do modelo. `validarDia` (`vendas/dia.ts`) e para parametro
 * de URL, onde texto ausente ou vazio significa "tela abrindo em hoje" — aqui
 * isso seria ERRADO: `de: ''` viraria "hoje" em silencio e o modelo poderia
 * inventar um periodo que o usuario nao pediu. Data que nao seja um
 * 'YYYY-MM-DD' de calendario real e recusa.
 */
function lerData(valor: unknown, hoje: string): string | null {
  if (typeof valor !== 'string') return null
  if (!DIA_ISO.test(valor)) return null

  const dia = validarDia(valor, hoje)
  return dia.aviso ? null : dia.dia
}

function diaEmUtc(dia: string): number {
  const [ano, mes, diaDoMes] = dia.split('-').map(Number)
  const data = new Date(Date.UTC(ano, mes - 1, diaDoMes))
  // `Date.UTC` trata anos 0-99 como 1900-1999; restaura o ano literal.
  if (ano >= 0 && ano < 100) data.setUTCFullYear(ano)
  return data.getTime()
}

/**
 * Dias do intervalo, INCLUSIVE nas duas pontas, por aritmetica — nao dia a dia.
 *
 * O intervalo vem do modelo, que tende a repetir qualquer data que o usuario
 * escreveu: um laco descendo dia a dia gastou ~8,9 s de CPU SINCRONA em
 * `0000-01-01..9999-12-31` antes de recusar, e isso trava o event loop do
 * servidor para todas as requisicoes concorrentes. Aqui sao duas contas.
 */
function diasInclusivos(de: string, ate: string): number {
  return (diaEmUtc(ate) - diaEmUtc(de)) / 86_400_000 + 1
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
