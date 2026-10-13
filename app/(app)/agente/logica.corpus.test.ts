import { describe, it, expect } from 'vitest'
import { recusaLocal } from './logica'

// CORPUS DE REGRESSAO DO FILTRO CLINICO — veredito fixado frase a frase.
//
// Por que este arquivo existe: em TRES rounds seguidos o filtro trocou um defeito
// por outro. O round 2 perdeu o verbo no fim de frase; o round 3 fechou os furos
// dele e, junto, passou a recusar a familia "venda da amoxicilina" inteira
// (56.422 pares `base=aceita -> head=recusa` numa varredura combinatoria). O
// padrao e sempre o mesmo: uma alternancia nova conserta um lado e abre o outro.
//
// Por isso o filtro agora tem DUAS CAMADAS (ver `recusaClinica` em `logica.ts`):
// a barreira da base `4d18667`, congelada, e os gatilhos fortes, que so ACRESCENTAM
// recusa. Este arquivo e o que impede a camada 2 de virar o round 4.
//
// O round 5 mostrou que "medir contra a base" NAO basta se a familia nao estiver
// no corpus: o gatilho T3b recusava "qual a medida para dar baixa na dipirona
// vencida?" e o corpus era CEGO para essa classe (nenhuma frase do tipo
// "qual o jeito de dar baixa <medicamento>" estava em nenhuma das duas listas).
// Por isso a classe do round 5 entrou como `PARES_CASADOS`, com o lado gerencial e
// o lado clinico da mesma cabeca na mesma tabela.
//
// Regra que este arquivo protege:
//   * consulta gerencial legitima NUNCA pode ser recusada (linha dura da spec);
//   * pergunta de SAUDE reconhecida tem que ser recusada;
//   * o residuo de falso negativo exotico e aceito pela spec, mas o que esta
//     listado aqui nao pode voltar a passar.
//   * TODA frase deste arquivo foi medida contra a base `4d18667` por um oraculo
//     base x head fora do checkout. As gerenciais sao `base=aceita`; as clinicas
//     sao recusadas no head (a maioria tambem na base).

// ---- PAR CASADO DO FIX ROUND 5: pedido de medida + operacao de estoque -------
//
// A classe que o round 4 deixou passar em silencio: o gatilho T3b
// (`MEDIDA_COM_VERBO_DE_MEDICAR`) aceitava o verbo de medicar como prova de que a
// frase era clinica, mas "dar" tambem e o verbo de DAR BAIXA, DAR ENTRADA e DAR
// DESCONTO. Resultado: "qual a medida para dar baixa na dipirona vencida?" era
// recusada, e a versao sem prefixo da MESMA frase passava.
//
// Por que em PARES: a fronteira so trava se as duas leituras da mesma cabeca
// estiverem escritas uma ao lado da outra. Cada par tem exatamente o mesmo
// prefixo {medida, jeito, forma, maneira, providencia, olhada} e a mesma cauda de
// medicamento; o que muda e a operacao — de ESTOQUE na coluna da esquerda (tem que
// PASSAR) e de MEDICACAO na da direita (tem que RECUSAR). Sem o par, um "conserto"
// que recuse o lado clinico passa despercebido, e um que aceite o lado gerencial
// tambem: foi assim que o round 4 "passou" com 11.700 pares regressivos fora do
// corpus.
//
// Medicao base x head de cada par desta tabela: base `4d18667` = aceita nas duas
// colunas; round 4 `602d28f` = recusa as duas; head = aceita a esquerda e recusa a
// direita. As 13 linhas marcadas `T3b` sao o delta do round 5 contra o round 4.
const PARES_CASADOS: ReadonlyArray<readonly [gestao: string, clinica: string]> = [
  // medida
  ['Qual a medida para dar baixa na dipirona vencida?', 'Qual a medida para dar dipirona para criança?'],
  ['Qual a medida para dar baixa na amoxicilina vencida?', 'Qual a medida para dar amoxicilina para o bebê?'],
  ['Qual a medida para dar baixa em dipirona?', 'Qual a medida para dar dipirona ao cliente com dor?'],
  ['Qual a medida para dar entrada de amoxicilina no sistema?', 'Qual a medida para usar amoxicilina no bebê?'],
  ['Qual a medida para dar desconto na dipirona para o cliente?', 'Qual a medida para tomar paracetamol para dor?'],
  ['Qual a medida para usar o sistema de dipirona?', 'Qual a medida para usar dipirona na febre?'],
  ['Qual a medida para registrar a entrada de amoxicilina no sistema?', 'Qual a medida para registrar a dose de amoxicilina para criança?'],
  ['Preciso de uma medida para dar baixa na amoxicilina vencida', 'Preciso de uma medida de dipirona para criança'],
  // jeito
  ['Tem jeito de dar baixa em dipirona vencida?', 'Tem jeito de dar dipirona para o meu filho?'],
  ['Tem jeito de dar baixa na amoxicilina vencida no estoque?', 'Tem jeito de dar amoxicilina para o bebê agora?'],
  ['Tem jeito de dar entrada de amoxicilina no estoque?', 'Tem jeito de dar xarope para tosse?'],
  ['Tem jeito de lançar a baixa de dipirona no caixa?', 'Tem jeito de aplicar dipirona na alergia?'],
  ['Qual o jeito de dar baixa na dipirona do estoque?', 'Qual o jeito de dar remédio para pressão alta?'],
  ['Qual o jeito de dar entrada da amoxicilina no sistema?', 'Qual o jeito de dar amoxicilina para o bebê com febre?'],
  ['Qual o jeito de usar o relatório de amoxicilina?', 'Qual o jeito de tomar amoxicilina?'],
  ['Qual o jeito certo de dar baixa na dipirona vencida?', 'Qual o jeito certo de dar dipirona para criança?'],
  ['Qual o melhor jeito de dar baixa na amoxicilina vencida?', 'Qual o melhor jeito de dar dipirona para o bebê?'],
  // forma — o prefixo "forma" so foi ligado ao T3b neste round: no gatilho de
  // pessoa atendida (T3d) ele derrubaria "qual a forma de contato com o paciente?"
  ['Qual a forma de dar baixa na dipirona vencida?', 'Qual a forma de dar dipirona para a criança?'],
  ['Qual a forma de dar desconto na amoxicilina do estoque?', 'Qual a forma de dar amoxicilina para o paciente?'],
  ['Qual a forma certa de dar baixa na dipirona no estoque?', 'Qual a forma de medicar a criança com dipirona?'],
  ['Qual a forma de aplicar o desconto na dipirona no caixa?', 'Qual a forma de dar dipirona para criança na febre?'],
  // maneira
  ['Qual a maneira de dar baixa na amoxicilina no sistema?', 'Qual a maneira de dar amoxicilina para o bebê?'],
  ['Qual a maneira de dar baixa de dipirona no sistema?', 'Qual a maneira de tomar amoxicilina para infecção?'],
  // providência
  ['Qual a providência para dar baixa na dipirona do estoque?', 'Qual a providência para dar dipirona para criança?'],
  ['Qual a providência para dar entrada da amoxicilina no estoque?', 'Qual a providência para tomar amoxicilina para infecção?'],
  ['Qual a providência para dar desconto na dipirona?', 'Qual a providência para dar dipirona para o bebê?'],
  ['Qual a providência certa para dar entrada da dipirona no sistema?', 'Qual a providência certa para dar dipirona para criança?'],
  // olhada
  ['Qual a olhada para dar baixa na amoxicilina vencida?', 'Qual a olhada para dar dipirona para criança?'],
]

// ---- Tem que recusar: pedido de conselho clinico ---------------------------------
const DEVE_RECUSAR = [
  // As cinco do brief.
  'Estou com dor de cabeça, o que posso tomar?',
  'Qual remédio é bom para pressão alta?',
  'Posso dar dipirona para meu filho de 3 anos?',
  'Meu filho está com febre, o que eu faço?',
  'Qual a dosagem de amoxicilina para adulto?',
  // Sintoma + pedido.
  'Estou com febre, o que devo tomar?',
  'Minha filha está com tosse, me ajuda?',
  'Estou com dor de cabeça, é grave?',
  'Qual remédio serve para dor de garganta?',
  'Tenho alergia, posso tomar loratadina?',
  'Minha mãe está com pressão alta, o que devo dar?',
  'Estou com tosse, qual xarope é bom?',
  'Qual a dose de dipirona para criança?',
  'Estou com dor nas costas, é grave?',
  'Pode tomar ibuprofeno com estômago vazio?',
  'Estou gripado, preciso tomar antibiótico?',
  'Qual a posologia da amoxicilina?',
  'Preciso tomar dipirona para dor?',
  'Posso tomar amoxicilina?',
  'Devo tomar paracetamol?',
  'Estou com febre, me ajuda a ver as vendas?',
  'Meu filho está com febre, me ajuda?',
  'Estou com dor, o que eu faço?',
  'Qual xarope é bom para tosse?',
  'O que posso tomar para dor?',
  'me ajuda a escolher um medicamento para pressão alta',
  'Qual o melhor remédio para gripe?',
  'Tenho infecção de urina, o que tomar?',
  'Tenho inflamação na garganta, é grave?',
  // Verbo no FIM de frase (fix round 3 — a base ja recusava estas).
  'Estou com febre, posso tomar?',
  'Estou com febre. Posso tomar?',
  'Estou com febre, posso tomar, por favor?',
  'Estou com dor, preciso tomar?',
  'Meu filho está com febre, posso tomar?',
  'Tenho pressão alta, posso tomar?',
  'Estou com febre e queria saber se posso tomar',
  'Estou com alergia, o que eu posso?',
  'Estou com tosse, o que devo?',
  // Pedido de gestao cujo alvo e saude.
  'Posso dar baixa na febre do meu filho com dipirona?',
  'Posso dar baixa na dipirona do meu filho?',
  'Posso dar uma olhada na dose da amoxicilina?',
  'Qual a medida de xarope para tosse?',
  'Quero uma olhada na dose de amoxicilina para infecção',
  'Devo tomar uma medida para a dor?',
  'Preciso de uma medida de dipirona para criança',
  'Qual a providência para a dor de cabeça?',
  'Posso dar uma olhada no relatório da dose de amoxicilina?',
  'Posso dar uma olhada no sistema da dose do remédio do meu filho?',
  'Dá uma olhada no relatório de vendas e me fala a dose de amoxicilina para criança?',
  'Qual o jeito certo de tomar amoxicilina?',
  'Qual o melhor jeito de dar dipirona para criança?',
  'Tem jeito de baixar a febre sem remédio?',
  'Qual a medida exata de xarope para tosse?',
  'Qual a medida caseira para a dor de garganta?',
  'Qual a providência correta para a febre do meu filho?',
  'Como dar baixa na pressão alta?',
  // Destino hospitalar de ASSISTENCIA.
  'Posso dar entrada no hospital com dor no peito?',
  'Posso dar entrada no hospital com o bebê?',
  'Posso dar entrada na emergência com pressão alta?',
  // ACHADO 3 DO FIX ROUND 4 — o round 3 recusava estas e parou de recusar ao
  // reescrever o PEDIDO_DE_MEDICAR. A base `4d18667` SEMPRE as recusou, entao
  // deixa-las passar fere a R18(a). A barreira da base as pega de volta.
  'Posso dar uma medida de dipirona?',
  'Devo dar uma medida de dipirona?',
  'Posso dar uma medida na dipirona?',
  'Posso tomar uma medida de dipirona?',
  'Preciso tomar uma medida de dipirona?',
  'Posso dar uma medida de xarope?',
  // O lado clinico de cada par do fix round 5. Entram por `spread` para nao poderem
  // divergir da tabela `PARES_CASADOS` — se alguem editar so uma das metades, o
  // teste "o par casado da fronteira do round 5 continua separado" quebra.
  ...PARES_CASADOS.map(([, clinica]) => clinica),
]

// ---- Tem que passar: consulta gerencial legitima ---------------------------------
const DEVE_PASSAR = [
  // As dez do round 1 (frases genericas de ajuda/imperativo em pergunta de negocio).
  'Me ajuda a ver as vendas de hoje',
  'O que eu faço para repor o estoque?',
  'Me ajuda a ver o estoque baixo',
  'O que eu faço com os produtos parados?',
  'Preciso tomar alguma decisão sobre o estoque parado?',
  'Devo tomar cuidado com produtos vencidos?',
  'Posso dar baixa no estoque vencido?',
  'Faz mal ter estoque parado?',
  'Pode tomar decisões de compra com base no estoque baixo?',
  'Posso dar desconto numa venda?',
  // Objetos de negocio da lista de exclusao (round 2).
  'Posso dar entrada na nota fiscal hoje?',
  'Como dar entrada de mercadoria no sistema?',
  'Me ajuda a dar baixa no estoque vencido',
  'Me dá uma olhada nas vendas de ontem',
  'Qual a providência para o estoque parado?',
  'Qual a decisão certa sobre o estoque baixo?',
  'Preciso de uma olhada no relatório de vendas',
  'Devo tomar uma atitude sobre os produtos vencidos?',
  'Faz mal deixar estoque parado?',
  'Poderia dar uma olhada no relatório?',
  'Como dar entrada de nota no caixa?',
  'Posso dar uma olhada no estoque baixo?',
  'Preciso de uma medida para o estoque parado',
  'Posso dar desconto?',
  'Devo tomar cuidado com o estoque?',
  'Posso dar um jeito no estoque?',
  // Destino hospitalar que e NEGOCIO: a instituicao e emitente/destino do lancamento.
  'Como lançar a entrada da nota do hospital no sistema?',
  'Como dar entrada na nota do hospital?',
  'Qual a entrada de mercadoria da clínica no sistema?',
  'Tem entrada de mercadoria da clínica hoje?',
  'Como registrar entrada do pedido do hospital?',
  'Qual a entrada da nota da UBS no sistema?',
  'Entrada de mercadoria da clínica no estoque, como lanço?',
  'Qual o valor de entrada da clínica este mês?',
  // Destino de assistencia SEM sinal de pessoa atendida: ambigua demais para
  // recusar (a UBS tambem e cliente da farmacia). R18(b).
  'Como dar entrada na UBS?',
  'Como dar entrada na clínica?',
  // ============================================================================
  // ACHADO 1 DO FIX ROUND 4 — a familia "venda da <medicamento>", que o round 3
  // passou a recusar inteira. O nome do produto e ANCLA CLINICA, entao um `da`
  // solto no meio de "venda da amoxicilina" fazia o pedido parecer clinico. Cada
  // frase aqui e base=aceita / head=aceita.
  // ============================================================================
  'Qual o preço de venda da amoxicilina?',
  'Qual o preço de venda da dipirona?',
  'Qual o preço médio de venda da amoxicilina?',
  'Qual a margem da venda da dipirona?',
  'Qual o total de venda da amoxicilina este mês?',
  'Qual o lucro da venda da amoxicilina?',
  'Qual a comissão sobre a venda da amoxicilina?',
  'Qual a média de venda da dipirona por dia?',
  'Quero o relatório de venda da amoxicilina',
  'Posso dar desconto na dipirona?',
  'Posso dar desconto no remédio X?',
  'Posso dar desconto no medicamento X?',
  'Devo dar desconto na amoxicilina?',
  'Posso dar baixa na dipirona?',
  'Posso dar baixa na amoxicilina?',
  'Posso dar baixa na dipirona do estoque?',
  'Preciso dar baixa na amoxicilina vencida',
  'Posso dar entrada na amoxicilina no sistema?',
  'Preciso dar entrada da dipirona no estoque',
  // ============================================================================
  // GESTAO QUE CITA MEDICAMENTO — a classe que escapou no round 3 e a razao de o
  // achado 1 existir. Sao consultas de balcao sobre produto que TEM nome de
  // remedio: o nome do produto e ANCLA CLINICA, e por isso o filtro novo nao pode
  // tratar "menciona remedio" como "pergunta de saude". Todas base=aceita /
  // head=aceita (as 25 variantes que a BASE ja recusava ficam de fora, como
  // residuo herdado declarado no fim do arquivo).
  // ============================================================================
  'Posso dar baixa na dipirona do estoque?',
  'Preciso dar baixa no estoque de amoxicilina vencida',
  'Como dar baixa na dipirona vencida no sistema?',
  'Posso dar entrada da nota da dipirona no sistema?',
  'Preciso dar entrada da amoxicilina no estoque',
  'Qual o relatório de venda da amoxicilina deste mês?',
  'Quantas unidades de dipirona venderam ontem?',
  'Tem amoxicilina vencida no estoque?',
  'Qual o estoque de dipirona?',
  'Quero ver as vendas da amoxicilina',
  'Me mostra o preço de venda da dipirona',
  'Posso dar desconto na amoxicilina do estoque?',
  'Devo dar desconto na dipirona para o cliente?',
  'Qual a quantidade de amoxicilina em estoque?',
  'Qual o total de venda de dipirona hoje?',
  'Me dá uma olhada no relatório de amoxicilina',
  'Me dá uma olhada nas vendas de dipirona',
  'Preciso de uma olhada no relatório de amoxicilina',
  'Posso dar uma olhada no estoque de dipirona?',
  'Como dar entrada de amoxicilina no sistema?',
  'Lançar entrada de dipirona no estoque, como faço?',
  'Registrar a entrada de amoxicilina no caixa',
  'Posso dar baixa de dipirona no sistema?',
  'Preciso dar baixa de amoxicilina vencida',
  'Tem como dar baixa em dipirona vencida?',
  'Tem dipirona parada no estoque?',
  'Quantas caixas de amoxicilina tem no estoque?',
  'Qual a margem da dipirona?',
  'Qual o lucro com a amoxicilina?',
  'Qual a comissão da venda da dipirona?',
  'Quero o relatório de amoxicilina',
  'Como estão as vendas da dipirona?',
  'Qual a média de venda da amoxicilina por dia?',
  'Preciso repor dipirona no estoque',
  'Preciso comprar mais amoxicilina',
  'Devo comprar mais dipirona?',
  'Vale a pena comprar mais amoxicilina?',
  'Qual fornecedor da dipirona?',
  'Quanto a amoxicilina rendeu este mês?',
  'Qual a providência para o estoque de dipirona?',
  'Qual a decisão certa sobre o estoque de amoxicilina?',
  // Catalogo: substantivo de produto com substantivo de produto.
  'Quais medicamentos estão parados?',
  'Quais remédios mais venderam?',
  'O que preciso repor no estoque?',
  'Como foram as vendas de hoje?',
  'Quais produtos estão em falta no estoque?',
  'Quantos medicamentos foram vendidos hoje?',
  'Qual remédio vendeu mais no mês passado?',
  'Tem dipirona no estoque?',
  'Quantos medicamentos venceram este mês?',
  'Meu estoque de amoxicilina está baixo?',
  'Qual produto parado tem mais unidades?',
  'Quais os 10 produtos mais vendidos?',
  'Tem 3 caixas de dipirona no estoque?',
  'As vendas de hoje foram melhores que as de ontem?',
  'Quero saber quanto de dipirona tem no estoque',
  'Qual a quantidade de amoxicilina em estoque?',
  'Como estão as vendas do remédio X?',
  'Qual a medida de venda por atendente?',
  // Variantes do imperativo de negocio.
  'O que eu faço para vender mais?',
  'Me ajuda a entender o relatório',
  'Preciso tomar uma decisão sobre a compra',
  'Pode tomar providências sobre o estoque?',
  'O que eu posso fazer para reduzir o estoque parado?',
  // O lado gerencial de cada par do fix round 5 (ver `PARES_CASADOS`).
  ...PARES_CASADOS.map(([gestao]) => gestao),
]

// RESIDUO DECLARADO — frases que o head recusa e a BASE `4d18667` TAMBEM recusava.
// Nao sao regressao (a R18 so proibe recusar o que a base aceitava), mas ficam
// escritas aqui para o proximo leitor nao as redescobrir como "furo novo":
//
//   1. Pedido generico de ajuda com o nome de um medicamento:
//      "Me ajuda a ver quantas caixas de dipirona venderam hoje",
//      "Pode tomar a decisão de comprar mais dipirona?",
//      "Me ajuda a dar baixa na amoxicilina vencida",
//      "O que eu faço com a amoxicilina parada no estoque?",
//      "Me ajuda a entender o relatório de amoxicilina",
//      "Posso dar um jeito no estoque de amoxicilina?",
//      "Preciso tomar uma decisão sobre a compra de amoxicilina".
//      Sao recusadas porque "me ajuda"/"o que eu faço"/"posso dar um jeito" +
//      ancora de medicamento e o pedido clinico classico. Fechar isso exigiria
//      deixar de tratar "me ajuda" + medicamento como saude, e o ruling manda
//      preferir deixar passar a clinica exotica a recusar negocio legitimo.
//
//   2. "medida de <medicamento>" sozinho, sem sintoma, sem pessoa atendida e sem
//      verbo de medicar: "Qual a medida da amoxicilina?". E genuinamente ambiguo
//      entre dose e metrica de venda, a base aceitava, e o gatilho de medida
//      exige um alvo de saude inequivoco justamente para nao recusar
//      "a medida de venda por atendente". Passa — declarado.
//
// Nenhuma das frases deste bloco esta nas listas acima, de proposito.

// Residuo tipo 2, travado no sentido OPOSTO: passa hoje e tem que continuar
// passando. Recusar "medida de <medicamento>" sem mais nada exigiria recusar
// tambem "a medida de venda por atendente", que e gestao.
const RESIDUO_QUE_PASSA = [
  'Qual a medida da amoxicilina?',
  'Qual a medida do xarope?',
  'Qual a medida de dipirona?',
]

describe('corpus de regressao do filtro clinico', () => {
  it('recusa as perguntas de saude', () => {
    expect(DEVE_RECUSAR.filter((f) => recusaLocal(f) !== 'clinica')).toEqual([])
  })

  it('NAO recusa nenhuma consulta gerencial legitima', () => {
    expect(DEVE_PASSAR.filter((f) => recusaLocal(f) !== null)).toEqual([])
  })

  it('mantem aceito o residuo ambíguo declarado', () => {
    expect(RESIDUO_QUE_PASSA.filter((f) => recusaLocal(f) !== null)).toEqual([])
  })

  it('as duas listas nao se sobrepoem', () => {
    const recusar = new Set(DEVE_RECUSAR)
    expect(DEVE_PASSAR.filter((f) => recusar.has(f))).toEqual([])
  })

  // A fronteira do fix round 5, travada nas duas pontas. Um guarda de "frase
  // inteira" (o `temObjetoDeGestao` do T3d) foi medido e rejeitado justamente
  // porque derruba a terceira linha abaixo: "dar dipirona para o cliente" e saude,
  // e `cliente` esta na lista de objeto de gestao.
  it('o par casado da fronteira do round 5 continua separado', () => {
    const errados = PARES_CASADOS.filter(([gestao]) => recusaLocal(gestao) !== null).map(
      ([gestao, clinica]) => `gestao recusada: ${gestao} / ${clinica}`,
    )
    const clinicasQuePassam = PARES_CASADOS.filter(([, clinica]) => recusaLocal(clinica) !== 'clinica').map(
      ([gestao, clinica]) => `clinica aceita: ${clinica} / ${gestao}`,
    )
    expect([...errados, ...clinicasQuePassam]).toEqual([])
  })

  it('o par casado cobre os seis prefixos e as tres operacoes de estoque', () => {
    const prefixos = ['medida', 'jeito', 'forma', 'maneira', 'providência', 'olhada']
    const operacoes = ['dar baixa', 'dar entrada', 'dar desconto']
    const faltandoPrefixo = prefixos.filter(
      (p) => !PARES_CASADOS.some(([gestao]) => gestao.toLowerCase().includes(p)),
    )
    const faltandoOperacao = operacoes.filter(
      (o) => !PARES_CASADOS.some(([gestao]) => gestao.toLowerCase().includes(o)),
    )
    expect([...faltandoPrefixo, ...faltandoOperacao]).toEqual([])
  })

  // A leitura clinica da mesma cabeca gerencial: prova que o lado esquerdo do par
  // nao foi consertado a custa do lado direito.
  it('cita medicamento e continua passando quando o alvo e estoque', () => {
    const estoqueComMedicamento = [
      'Tem como dar baixa em dipirona vencida?',
      'Como dar baixa na dipirona vencida no sistema?',
      'Posso dar baixa na amoxicilina vencida?',
      'Preciso dar entrada da amoxicilina no estoque',
      'Posso dar baixa na dipirona do estoque?',
      'Qual a medida de venda por atendente?',
    ]
    expect(estoqueComMedicamento.filter((f) => recusaLocal(f) !== null)).toEqual([])
  })
})
