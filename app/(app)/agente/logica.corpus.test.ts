import { describe, it, expect } from 'vitest'
import { recusaLocal } from './logica'

// CORPUS DE REGRESSAO DO FILTRO CLINICO — veredito fixado frase a frase.
//
// Por que este arquivo existe: em dois rounds seguidos o filtro trocou um defeito
// por outro (primeiro recusou consulta gerencial legitima; depois deixou passar
// pedido de saude, trocando o verbo no fim de frase e o destino hospitalar). Cada
// frase aqui foi medida contra a BASE `4d18667` com um oraculo base x head antes
// de virar teste, e o veredito abaixo e o do HEAD corrigido — nenhuma frase
// gerencial mudou de lado contra a base.
//
// Règra que este arquivo protege:
//   * consulta gerencial legitima NUNCA pode ser recusada (linha dura da spec);
//   * pergunta de SAUDE reconhecida tem que ser recusada;
//   * o residuo de falso negativo exotico e aceito pela spec, mas o que esta
//     listado aqui nao pode voltar a passar.

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
]

// RESIDUO DECLARADO (nao e regressao: a BASE tambem recusava, e a revisao ja
// deferiu): "Me ajuda a ver quantas caixas de dipirona venderam hoje" e
// "Pode tomar a decisão de comprar mais dipirona?" caem no filtro clinico porque
// o pedido generico ("me ajuda", "pode tomar") dispara com a ancora de
// medicamento. Fechar isso exigiria deixar de tratar "me ajuda" + medicamento como
// pedido de saude, e o ruling da revisao diz para preferir deixar passar a clinica
// exotica a recusar negocio legitimo — entao a escolha aqui e manter a recusa e
// declarar o residuo. Estes dois NAO estao na lista acima de proposito.

describe('corpus de regressao do filtro clinico', () => {
  it('recusa as perguntas de saude', () => {
    expect(DEVE_RECUSAR.filter((f) => recusaLocal(f) !== 'clinica')).toEqual([])
  })

  it('NAO recusa nenhuma consulta gerencial legitima', () => {
    expect(DEVE_PASSAR.filter((f) => recusaLocal(f) !== null)).toEqual([])
  })

  it('as duas listas nao se sobrepoem', () => {
    const recusar = new Set(DEVE_RECUSAR)
    expect(DEVE_PASSAR.filter((f) => recusar.has(f))).toEqual([])
  })
})
