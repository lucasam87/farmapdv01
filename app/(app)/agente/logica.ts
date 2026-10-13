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
//
// A DECISAO TEM DUAS CAMADAS, NESTA ORDEM, E A ORDEM E A GARANTIA:
//
//   1. BARREIRA DA BASE (`barreiraDaBase`) — a triagem clinica da base `4d18667`,
//      reproduzida VERBATIM. A R18 exige que nada que ela recusava volte a passar,
//      e a unica forma de cumprir isso por CONSTRUCAO (em vez de por amostra) e
//      manter a barreira inteira como primeiro passo, sem reescrever nada.
//   2. GATILHOS FORTES (`gatilhoForte`) — as classes de SAUDE que a base deixava
//      passar. Cada gatilho e uma classe fechada e so pode ACRESCENTAR recusa.
//
// A assimetria e deliberada e e o que os rounds anteriores erraram: re-derivar a
// decisao inteira a partir das regras novas troca um lado pelo outro (foi assim
// que o round 2 perdeu o verbo no fim de frase e o round 3 recusou a familia
// "venda da amoxicilina"). Aqui, o que a base acerta fica travado e o que ela erra
// entra como acrescimo medido um a um.
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
  /(qual a (dosagem|dose|posologia)|quanto (eu )?(posso|devo) tomar\b|quantas gotas|quantos comprimidos|o que (eu )?(posso |devo )?tomar\b|qual (o )?(melhor )?(remedio|medicamento|medicament|antibiotico|xarope|pomada|analgesico)[^?]*\b(e bom|serve|indica|posso|e melhor|melhor|pra|para)\b)/i

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
// A palavra "medicamento" e PROIBIDA nas alternativas deste padrao: qualquer
// `me ajuda` que a contivesse viraria recusa clinica. Quem cobre a variante
// "me ajuda a escolher um medicamento para pressao alta" e o portao de
// ANCORA_CLINICA.
const PEDIDO_DE_AJUDA =
  /(o que (eu )?(posso|devo)( fazer)?|posso (da|tomo|tomar)\b|preciso (tomar|da)\b|devo (tomar|da)\b|me ajuda\b|o que eu faco|faz mal\b|pode (tomar|dar)\b|e grave\b|quem pode tomar\b)/i

// Pedido que so faz sentido medicando alguem: "posso dar dipirona para meu filho",
// "preciso tomar antibiotico". Exige a ancora clinica e um complemento depois do
// verbo — e isso que impede "posso dar baixa no estoque vencido" de casar.
//
// A lista de exclusao e o que separa TOMAR/DAR medicamento de TOMAR/DAR decisao,
// cuidado, baixa, desconto, entrada, uma olhada ou providencia: sem ela, a classe
// gerencial inteira ("devo tomar cuidado com o estoque?") voltaria a ser recusada.
// Nao acrescente alternativas aqui sem medir: o round 3 removeu esta lista e
// recusou 56.422 frases gerenciais na varredura (a familia "venda da amoxicilina"),
// porque `da` do verbo passou a casar DENTRO de "venda".
const PEDIDO_DE_MEDICAR =
  /((posso|devo) (tomar|dar)\s+(?!baixa\b|desconto\b|entrada\b|jeito\b|uma olhada\b|providencia|medida\b)\S|preciso (tomar|dar)\s+(?!baixa\b|desconto\b|entrada\b|decisao|providencia|medida\b|uma)\S|quem pode tomar\b)/i

// ============================================================
// CAMADA 1 — A BARREIRA DA BASE `4d18667`, CONGELADA.
//
// Este e o filtro clinico que a revisao da Tarefa 2 ja aprovou, reproduzido sem
// uma virgula de diferenca. Ele NAO se reescreve: a regra da R18 e "nenhuma frase
// que a base recusava pode passar, nenhuma que a base aceitava pode recusar", e a
// unica forma de cumprir a primeira metade por CONSTRUCAO (e nao por amostra) e
// manter a barreira inteira no comeco da decisao. Os rounds 2 e 3 tentaram
// re-derivar a decisao inteira a partir das regras novas e cada tentativa trocou
// um lado pelo outro; por isso ela fica aqui, isolada e intocada.
//
// Toda melhoria entra na CAMADA 2, que so pode ACRESCENTAR recusa.
// ============================================================
function barreiraDaBase(texto: string): boolean {
  // (a) dose ou escolha de medicamento: sozinho ja e conselho de saude.
  if (GATILHO_CLINICO_DIRETO.test(texto)) return true

  // Sem ancora clinica nao ha conselho de saude nenhum: "me ajuda a ver as
  // vendas", "o que eu faco para repor o estoque?" e "posso dar desconto?" sao
  // gerenciais e SEGUEM.
  if (!ANCORA_CLINICA.test(texto)) return false

  // (b) sintoma ou medicamento + pedido de conselho/ajuda.
  if (PEDIDO_DE_AJUDA.test(texto)) return true

  // (c) sintoma ou medicamento + "e bom para isso?", "posso dar/tomar isso?".
  // "meu filho" sozinho NAO recusa: pode ser nome de cadastro. O que recusa e o
  // preparo para medicar alguem, e e por isso que o pedido precisa de complemento.
  if (PEDIDO_DE_MEDICAR.test(texto)) return true

  const temSintoma = SITUACAO_CLINICA.test(texto)
  return temSintoma && /(e bom\b|serve para\b|e indicado\b|funciona\b|posso usar\b|pode dar\b|pode tomar\b)/i.test(texto)
}

// ============================================================
// CAMADA 2 — GATILHOS FORTES (o que a base deixava passar).
//
// Cada gatilho e uma CLASSE FECHADA de alta precisao: um pedido de gestao de
// farmacia nao fala de febre, nao fala de "dose" e nao da baixa num sintoma. Sao
// eles que fecham os furos apontados na revisao do round 3 sem tocar na barreira.
//
// Um gatilho novo so entra se a varredura combinatoria base x head mostrar ZERO
// pares `base=aceita -> head=recusa`. Nao ha gatilho "obvio" o bastante para
// dispensar a medicao: a familia "venda da amoxicilina" nasceu exatamente de um
// gatilho que parecia obvio.
// ============================================================

// Vocabulario sem acento (o texto ja passou por `semAcento`).
const ALVO_DE_SAUDE =
  'dose|dosagem|posologia|febre|dor(es)?|tosse|gripe|resfriado|infeccao|inflamacao|alergia|diarreia|vomito|nausea|pressao|glicose|colesterol|queimadura|colica|ansiedade|insonia|gravidez|gravida|gestante|amamenta'
const PESSOA_ATENDIDA =
  'crianca|bebe|menino|menina|filho|filha|mae|pai|vovo|idoso|paciente'
const NOME_DE_MEDICAMENTO =
  'remedio|medicamento|medicament|antibiotico|amoxicilina|dipirona|paracetamol|ibuprofeno|loratadina|omeprazol|analgesico|xarope|pomada|comprimido|capsula|gotas'
// Objeto de GESTAO: quando ele aparece na frase, o gatilho de pessoa atendida
// (T3d) NAO dispara. E o que separa "uma medida de dipirona para crianca" (saude)
// de "uma olhada na dipirona do estoque" (gestao).
//
// "comprovante" entrou no fix round 5: ele JA era contexto de negocio do T1
// (`CONTEXTO_DE_NEGOCIO`) mas tinha ficado de fora desta lista, e a assimetria
// deixava "qual a medida para usar o comprovante de dipirona?" passar como saude.
const OBJETO_DE_GESTAO =
  'comprovante|estoque|nota|fiscal|mercadoria|produto|produtos|relatorio|venda|vendas|sistema|caixa|pedido|compra|planilha|fornecedor|cliente|clientes|preco|margem|conta|contas|financeiro|valor|fatura|lucro|comissao|custo|cadastro|lote|validade|vencimento|balanco|faturamento|nf|nfe'

const temObjetoDeGestao = new RegExp(`\\b(?:${OBJETO_DE_GESTAO})\\b`, 'i')
// Sinal de pessoa atendida: sintoma, dose ou alguem sendo tratado. E o que
// distingue "dar entrada no hospital com o bebe" (assistencia) de "dar entrada na
// UBS" (a UBS como cliente da farmacia).
const SINAL_DE_PESSOA_ATENDIDA = new RegExp(`\\b(?:${ALVO_DE_SAUDE}|${PESSOA_ATENDIDA})\\b`, 'i')

// (T1) ENTRADA COM DESTINO DE ASSISTENCIA. "dar entrada no hospital com dor no
// peito" e assistencia; "dar entrada na nota do hospital" e lancamento. Exige as
// duas coisas juntas: o DESTINO de assistencia E um sinal de pessoa atendida na
// frase — e nenhum contexto de negocio. Sem o sinal de pessoa, "como dar entrada
// na UBS?" fica ambigua demais para recusar (a UBS tambem e cliente da farmacia),
// e a R18 manda deixar passar.
const CONTEXTO_DE_NEGOCIO =
  /\b(?:nota|mercadoria|estoque|sistema|pedido|valor|planilha|caixa|fornecedor|lancar|registrar|cadastr\w*|comprovante|fatura|nf|nfe)\b/i
const DESTINO_DE_ASSISTENCIA = new RegExp(
  `\\b(?:dar entrada|registrar entrada|lancar entrada|entrada)\\b(?:\\s+\\S+){0,3}\\s+` +
    `(?:hospital|emergencia|pronto[- ]socorro|upa|ubs|posto de saude|maternidade|clinica)\\b`,
  'i',
)

// (T2) BAIXA QUE NAO E DE ESTOQUE. "dar baixa na febre", "dar baixa na pressao
// alta" e "dar baixa na dipirona do meu filho" sao o ato de tratar alguem; "dar
// baixa na dipirona" e "dar baixa na amoxicilina vencida" sao o ato de baixar
// mercadoria. O que separa e o alvo: sintoma, ou medicamento ligado a pessoa.
const BAIXA_COM_ALVO_DE_SAUDE = new RegExp(
  `\\bbaixa(?:r|mento)?\\b(?:\\s+\\S+){0,4}\\s+(?:${ALVO_DE_SAUDE})\\b`,
  'i',
)
const BAIXA_EM_MEDICAMENTO_DE_PESSOA = new RegExp(
  `\\bbaixa(?:r|mento)?\\b(?:\\s+\\S+){0,4}\\s+(?:${NOME_DE_MEDICAMENTO})\\b` +
    `(?:\\s+\\S+){0,3}\\s+(?:para|pro|pra|do|da|de|no|na)?\\s*(?:${PESSOA_ATENDIDA})\\b`,
  'i',
)

// (T3) PEDIDO DE "MEDIDA": "uma medida", "uma olhada", "um jeito", "uma
// providencia". A palavra sozinha e generica de portugues e nao recusa nada ("uma
// medida para o estoque parado" e gestao); quem decide e o ALVO que vem depois:
//
//   T3a: alvo de SAUDE inequivoco (sintoma, dose) em qualquer posicao da janela.
//        Vale mesmo com objeto de gestao no meio: "uma olhada no relatorio DA
//        DOSE DE amoxicilina" e pergunta de SAUDE.
//   T3b: "jeito de tomar amoxicilina", "jeito de dar dipirona" — o verbo de
//        medicar desambiguia o catalogo. O verbo SOZINHO nao basta (ver o achado
//        do fix round 5 logo abaixo): ele ainda exige que o que vem depois dele
//        nao seja uma operacao de gestao ("dar BAIXA", "dar ENTRADA", "aplicar o
//        DESCONTO") nem um objeto de gestao.
//   T3d: pessoa atendida no pedido ("uma medida de dipirona para crianca"), e so
//        quando NAO ha objeto de gestao nenhum na frase.
//   T3e: "decisao"/"atitude" so com alvo de saude inequivoco perto — sao palavras
//        de gestao legitima ("a decisao certa sobre o estoque baixo") e nao podem
//        recusar sozinhas.
//
// NAO existe gatilho para "medida de <medicamento>" sozinho ("qual a medida da
// amoxicilina?"). A frase e genuinamente ambigua entre dose e metrica de venda, a
// base `4d18667` a aceitava, e a R18 manda deixar passar a clinica duvidosa em vez
// de recusar a gerencial. Fica como residuo declarado.
const PEDIDO_DE_MEDIDA = 'medida|olhada|jeito|providencia|providencias'
// "forma" e "maneira" entram SO no gatilho que exige o verbo de medicar (T3b).
// No `PEDIDO_DE_MEDIDA` compartilhado elas derrubariam "qual a forma de contato
// com o paciente?" (medido: 1 falso positivo gerencial), porque o T3d aceita
// qualquer palavra de pessoa atendida sem verbo. Aqui, presas ao verbo, elas so
// recusam o que e inequivocamente medicacao.
const FORMA_DE_FAZER = 'forma|maneira'
const MEDIDA_COM_ALVO_DE_SAUDE = new RegExp(
  `\\b(?:${PEDIDO_DE_MEDIDA})\\b(?:\\s+\\S+){0,9}\\s+(?:${ALVO_DE_SAUDE})\\b`,
  'i',
)
// "decisao"/"atitude" sao palavras de gestao de verdade ("a decisao certa sobre o
// estoque baixo"), entao so recusam com um alvo de SAUDE inequivoco perto e numa
// janela curta: "qual a decisao sobre a DOSE do remedio". Fora daqui, ficam como
// estao — a R18 manda preferir deixar passar a clinica duvidosa.
const AVALIACAO_COM_ALVO_DE_SAUDE = new RegExp(
  `\\b(?:decisao|decisoes|atitude|atitudes)\\b(?:\\s+\\S+){0,6}\\s+(?:${ALVO_DE_SAUDE})\\b`,
  'i',
)
// ACHADO UNICO DO FIX ROUND 5 — o verbo de medicar NAO desambigua sozinho.
//
// Sem os dois lookaheads abaixo este gatilho recusava a classe inteira de gestao
// de estoque que comeca com um pedido de medida e cita um medicamento:
// "qual a medida para dar baixa na dipirona vencida?", "tem jeito de dar baixa em
// dipirona vencida?", "qual a providencia para dar entrada da amoxicilina no
// estoque?". A razao e que "dar" tambem e o verbo de DAR BAIXA, DAR ENTRADA e DAR
// DESCONTO, e "usar"/"aplicar" valem para "usar o sistema" e "aplicar o desconto".
// Medido: 16.320 pares `base=aceita -> head=recusa` na familia
// "prefixo x dar baixa/entrada/desconto x medicamento x sufixo", 7.440 deles novos
// contra o round 3.
//
// Os dois lookaheads sao a correcao MINIMA; nao ha guarda de frase inteira aqui.
//   * o primeiro e a MESMA lista de exclusao que o `PEDIDO_DE_MEDICAR` ja usa na
//     camada 1 (o "baixa/desconto/entrada" que separa medicar de gerir);
//   * o segundo olha o objeto de gestao LOGO depois do verbo. E deliberadamente
//     local: um guarda de frase inteira (`temObjetoDeGestao`, como o T3d) foi
//     medido e REJEITADO — ele deixaria passar "qual a medida para dar dipirona
//     para o cliente?", que e saude (1.700 deltas clinicos perdidos).
const MEDIDA_COM_VERBO_DE_MEDICAR = new RegExp(
  `\\b(?:${PEDIDO_DE_MEDIDA}|${FORMA_DE_FAZER})\\b(?:\\s+\\S+){0,6}\\s+(?:tomar|dar|usar|aplicar|ministrar|medicar)\\b` +
    `(?!\\s+(?:o |a |os |as |um |uma )?(?:baixa|desconto|entrada|saida)\\b)` +
    `(?!\\s+(?:o |a |os |as |um |uma )(?:${OBJETO_DE_GESTAO})\\b)` +
    `(?:\\s+\\S+){0,3}\\s+(?:${NOME_DE_MEDICAMENTO}|${ALVO_DE_SAUDE})\\b`,
  'i',
)
const MEDIDA_COM_PESSOA = new RegExp(
  `\\b(?:${PEDIDO_DE_MEDIDA})\\b(?:\\s+\\S+){0,6}\\s+(?:${PESSOA_ATENDIDA})\\b`,
  'i',
)

function gatilhoForte(texto: string): boolean {
  // (T1) destino de assistencia E sinal de pessoa atendida E nenhum contexto de
  // negocio.
  if (DESTINO_DE_ASSISTENCIA.test(texto) && !CONTEXTO_DE_NEGOCIO.test(texto)) {
    if (SINAL_DE_PESSOA_ATENDIDA.test(texto)) return true
  }

  if (BAIXA_COM_ALVO_DE_SAUDE.test(texto)) return true
  if (BAIXA_EM_MEDICAMENTO_DE_PESSOA.test(texto)) return true

  if (MEDIDA_COM_ALVO_DE_SAUDE.test(texto)) return true
  if (AVALIACAO_COM_ALVO_DE_SAUDE.test(texto)) return true
  if (MEDIDA_COM_VERBO_DE_MEDICAR.test(texto)) return true

  const gestao = temObjetoDeGestao.test(texto)
  if (!gestao && MEDIDA_COM_PESSOA.test(texto)) return true

  return false
}

// CPF com ou sem pontuacao (11 digitos). O `\b` no fim impede casar um numero
// maior por acidente.
const CPF_COM_PONTOS = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/
const CPF_SEM_PONTOS = /\b\d{11}\b/

// Telefone brasileiro COM DDD e o nono digito: (11) 98765-4321 / 11 98765-4321.
// Os separadores sao obrigatorios, e por isso que '01/01/2026' NAO casa: uma
// data nao tem um bloco de 4 ou 5 digitos depois do primeiro separador.
const TELEFONE = /(?:\+?55[\s-]?)?(?:\(\d{2}\)|\b\d{2})[\s.-]?\d{4,5}[\s.-]?\d{4}\b/

const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/

/**
 * O filtro clinico, em duas camadas e nesta ordem. A ordem E a garantia:
 *
 *   1. `barreiraDaBase` — o veredito ja revisado da base `4d18667`. Se ele recusa,
 *      acabou: por construcao, nada que a base recusava volta a passar.
 *   2. `gatilhoForte` — as classes de saude que a base deixava passar.
 *
 * O passo 2 so pode ACRESCENTAR recusa. Todo o risco deste filtro mora nele, e por
 * isso ele e medido contra a base numa varredura combinatoria: o numero de pares
 * `base=aceita -> head=recusa` tem que ser zero.
 */
function recusaClinica(pergunta: string): boolean {
  // Os padroes sao ASCII e o `\b` so e fronteira de palavra de verdade sem
  // acento: quem tira o acento e esta linha, uma vez por pergunta.
  const texto = semAcento(pergunta)

  if (barreiraDaBase(texto)) return true
  return gatilhoForte(texto)
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
 *
 * O QUE ESTA FUNCAO PROMETE:
 *   * recusar PADROES de CPF, telefone e e-mail reconheciveis;
 *   * recusar PADROES CLINICOS CONHECIDOS — as classes do corpus de regressao
 *     (`logica.corpus.test.ts`) e as que a base `4d18667` ja recusava;
 *   * nunca recusar uma consulta gerencial que a base `4d18667` aceitava. A
 *     varredura combinatoria base x head tem que devolver ZERO pares
 *     `base=aceita -> head=recusa`, e o corpus trava a classe. O corpus tem uma
 *     secao propria para a classe do fix round 5 (pedido de medida + operacao de
 *     estoque + medicamento), montada em PARES CASADOS: a versao gerencial e a
 *     versao clinica da mesma cabeca, uma ao lado da outra;
 *   * nunca chamar nada nem consultar view por conta propria.
 *
 * O QUE ESTA FUNCAO NAO PROMETE (o residuo aceito pela spec):
 *   * reconhecer TODA forma de pergunta clinica. Um filtro textual em portugues
 *     nao cobre parafrase, giria, erro de digitacao nem pergunta clinica sem
 *     nenhuma palavra da lista ("e ai, o que eu faco com isso?"). A spec diz
 *     literalmente que "nenhum filtro textual consegue reconhecer toda forma
 *     possivel" e que os padroes cobertos sao os CONHECIDOS;
 *   * reconhecer todo dado pessoal: nome completo, RG, endereco, cartao ou
 *     prontuario passam, porque nao ha padrao confiavel para eles;
 *   * distinguir "medida" de DOSE de "medida" de METRICA quando nao ha nem verbo
 *     de medicar nem alvo de saude nem pessoa atendida: "qual a medida da
 *     amoxicilina?" PASSA (residuo 2 do corpus). Recusa-la recusaria tambem
 *     "a medida de venda por atendente", e a R18 manda deixar passar a clinica
 *     duvidosa em vez de recusar a gerencial;
 *   * cobrir o pedido generico de AJUDA que cita medicamento: "me ajuda a dar
 *     baixa na amoxicilina vencida" e recusado — e a base `4d18667` tambem o
 *     recusava, entao nao e regressao, mas tambem nao e acerto novo.
 *   Ela e uma barreira de BOA FE, nao uma garantia de que nada sensivel escapa.
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
