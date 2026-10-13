import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { bytesDoPayload } from '@/lib/agente/deepseek'
import {
  LIMITE_PERGUNTA,
  LIMITE_PAYLOAD_BYTES,
  TOKENS_ENTRADA_RESERVA,
  MAX_TOKENS_SAIDA,
  MODELO,
  TETO_MENSAL_MICROS,
  DIAS_MAXIMOS,
  LIMITE_RESULTADOS,
  TARIFA_ENTRADA_MICROS_POR_MILHAO,
  TARIFA_SAIDA_MICROS_POR_MILHAO,
  RESERVA_MICROS,
  validarPergunta,
  recusaLocal,
  validarClassificacao,
  custoMicros,
  mesSaoPaulo,
  montarResposta,
  mensagemRecusa,
} from './logica'

const HOJE = '2026-10-09'

describe('constantes do contrato', () => {
  it('fixa os limites do plano', () => {
    expect(LIMITE_PERGUNTA).toBe(500)
    expect(LIMITE_PAYLOAD_BYTES).toBe(4096)
    expect(TOKENS_ENTRADA_RESERVA).toBe(4096)
    expect(MAX_TOKENS_SAIDA).toBe(120)
    expect(MODELO).toBe('deepseek-flash')
    expect(TETO_MENSAL_MICROS).toBe(5_000_000)
    expect(DIAS_MAXIMOS).toBe(31)
    expect(LIMITE_RESULTADOS).toBe(10)
    expect(TARIFA_ENTRADA_MICROS_POR_MILHAO).toBe(300_000)
    expect(TARIFA_SAIDA_MICROS_POR_MILHAO).toBe(1_200_000)
  })

  it('o teto do mes da constante e o MESMO literal da RPC do banco (017)', () => {
    // Minor 7 da revisao final: NENHUM codigo de producao le `TETO_MENSAL_MICROS`.
    // Quem recusa a reserva que passa do teto e o banco, no literal da RPC. Este
    // teste amarra os dois numeros para a constante nao virar uma sensacao falsa de
    // controle sobre o dinheiro (mudar o TS nao mudaria nada, em silencio).
    const sql = readFileSync(
      new URL('../../../supabase/migrations/017_orcamento_agente.sql', import.meta.url),
      'utf8',
    )

    // Endurecido na revisao final (o teste casava a regex CRUA no arquivo inteiro):
    //   (a) linhas de comentario `--` saem ANTES de casar, para o teste nao passar
    //       (nem quebrar) por causa de um comentario que cite a comparacao;
    //   (b) os espacos sao normalizados, para reformatar o SQL nao virar quebra
    //       ruidosa por um motivo que nao e o que este teste mede;
    //   (c) tem que existir EXATAMENTE UMA comparacao de teto no codigo, e a
    //       ausencia de qualquer uma falha com mensagem propria, e nao com um
    //       `undefined` comparado com string.
    const codigo = sql
      .split('\n')
      .filter((linha) => !linha.trimStart().startsWith('--'))
      .join('\n')
      .replace(/\s+/g, ' ')
    const comparacoes = [...codigo.matchAll(/v_consumido \+ p_micros > (\d+)/g)]

    expect(
      comparacoes.length,
      `nao achei a comparacao de teto na migration (017): esperava exatamente uma, encontrei ${comparacoes.length}`,
    ).toBe(1)
    expect(comparacoes[0]?.[1]).toBe(String(TETO_MENSAL_MICROS))
  })

  it('deriva a reserva das tarifas e dos limites, arredondando para cima', () => {
    // 4096 x 0,30/1e6 = 1228,8 micros; 120 x 1,20/1e6 = 144 micros.
    // A soma e 1372,8 -> 1373. O literal fixado aqui e o do plano: se a tarifa
    // mudar, a reserva derivada tem que bater com este numero ou o teste quebra.
    expect(TOKENS_ENTRADA_RESERVA * (TARIFA_ENTRADA_MICROS_POR_MILHAO / 1_000_000)).toBeCloseTo(1228.8, 5)
    expect(MAX_TOKENS_SAIDA * (TARIFA_SAIDA_MICROS_POR_MILHAO / 1_000_000)).toBe(144)
    expect(RESERVA_MICROS).toBe(1373)
  })
})

describe('validarPergunta', () => {
  it('aceita uma pergunta gerencial e devolve o texto aparado', () => {
    expect(validarPergunta('  Como foram as vendas de hoje?  ')).toEqual({
      ok: true,
      pergunta: 'Como foram as vendas de hoje?',
    })
  })

  it('recusa o que nao e texto', () => {
    expect(validarPergunta(null)).toEqual({ ok: false, motivo: 'vazia' })
    expect(validarPergunta(undefined)).toEqual({ ok: false, motivo: 'vazia' })
    expect(validarPergunta(42)).toEqual({ ok: false, motivo: 'vazia' })
    expect(validarPergunta({ pergunta: 'vendas' })).toEqual({ ok: false, motivo: 'vazia' })
  })

  it('recusa texto vazio ou so espacos', () => {
    expect(validarPergunta('')).toEqual({ ok: false, motivo: 'vazia' })
    expect(validarPergunta('   ')).toEqual({ ok: false, motivo: 'vazia' })
    expect(validarPergunta('\n\t ')).toEqual({ ok: false, motivo: 'vazia' })
  })

  it('aceita exatamente 500 caracteres e recusa 501', () => {
    const exatamente = 'a'.repeat(LIMITE_PERGUNTA)
    expect(validarPergunta(exatamente)).toEqual({ ok: true, pergunta: exatamente })

    const passou = 'a'.repeat(LIMITE_PERGUNTA + 1)
    expect(validarPergunta(passou)).toEqual({ ok: false, motivo: 'longa' })
  })

  it('conta caracteres do texto aparado, nao os espacos das bordas', () => {
    const passou = `   ${'a'.repeat(LIMITE_PERGUNTA + 1)}   `
    expect(validarPergunta(passou)).toEqual({ ok: false, motivo: 'longa' })
  })

  it('recusa 2049 caracteres acentuados pelo limite de caracteres', () => {
    // "ç" ocupa 2 bytes. Uma pergunta assim passaria de 4096 bytes, mas o limite
    // de caracteres pega antes — de proposito: e o limite mais barato.
    const acentos = 'ç'.repeat(2049)
    expect(acentos.length).toBe(2049)
    expect(validarPergunta(acentos)).toEqual({ ok: false, motivo: 'longa' })
  })

  it('conta caracteres visiveis, nao unidades UTF-16 dos emojis', () => {
    // 500 emojis sao 1.000 unidades UTF-16 e 2.000 bytes: cabe nos dois limites e
    // tem que ser aceito, senao o usuario veria "501 caracteres" numa pergunta
    // de 500 emojis.
    const pesados = '😀'.repeat(LIMITE_PERGUNTA)
    expect(pesados.length).toBe(2 * LIMITE_PERGUNTA)
    expect(new TextEncoder().encode(pesados).length).toBeLessThanOrEqual(LIMITE_PAYLOAD_BYTES)
    expect(validarPergunta(pesados)).toEqual({ ok: true, pergunta: pesados })

    expect(validarPergunta(`${pesados}😀`)).toEqual({ ok: false, motivo: 'longa' })
  })

  it('a guarda de payload e de fronteira: o pior caso real cabe, medido no payload', () => {
    // Minors 5 e 8 da revisao final. A versao antiga comparava
    // `LIMITE_PAYLOAD_BYTES` com `LIMITE_PERGUNTA * 4` — duas constantes, zero
    // codigo exercitado, e dava a checagem como cobertura. O que importa e o pior
    // payload POSSIVEL e REAL: o prompt fixo (1.016 bytes) mais 500 code points de
    // 4 bytes (emoji) = 3.016 de 4.096. Ou seja: `motivo: 'payload'` NAO e
    // alcancavel por uma pergunta valida hoje; a guarda fica como fronteira para o
    // dia em que o prompt crescer (ver `logica.ts` e `orquestracao.ts`).
    const piorCaso = bytesDoPayload('😀'.repeat(LIMITE_PERGUNTA))
    const tetoDaPergunta = new TextEncoder().encode('😀'.repeat(LIMITE_PERGUNTA)).length

    expect(tetoDaPergunta).toBe(LIMITE_PERGUNTA * 4)
    expect(piorCaso).toBe(3_016)
    expect(piorCaso).toBeLessThanOrEqual(LIMITE_PAYLOAD_BYTES)
  })

  it('recusa localmente antes de qualquer chamada externa', () => {
    expect(validarPergunta('Estou com dor de cabeça, o que posso tomar?')).toEqual({
      ok: false,
      motivo: 'clinica',
    })
    expect(validarPergunta('O CPF 123.456.789-09 tem dívida?')).toEqual({
      ok: false,
      motivo: 'pessoal',
    })
  })

  it('recusa o payload antes de olhar clinica ou PII', () => {
    const gigante = `O CPF 123.456.789-09 ${'a'.repeat(LIMITE_PERGUNTA + 1)}`
    expect(validarPergunta(gigante)).toEqual({ ok: false, motivo: 'longa' })
  })
})

describe('recusaLocal — clinica', () => {
  it('recusa as cinco perguntas de conselho clinico do brief', () => {
    expect(recusaLocal('Estou com dor de cabeça, o que posso tomar?')).toBe('clinica')
    expect(recusaLocal('Qual remédio é bom para pressão alta?')).toBe('clinica')
    expect(recusaLocal('Posso dar dipirona para meu filho de 3 anos?')).toBe('clinica')
    expect(recusaLocal('Meu filho está com febre, o que eu faço?')).toBe('clinica')
    expect(recusaLocal('Qual a dosagem de amoxicilina para adulto?')).toBe('clinica')
  })

  it('recusa sintoma com pedido de conselho ou de ajuda', () => {
    expect(recusaLocal('Estou com febre, o que devo tomar?')).toBe('clinica')
    expect(recusaLocal('Minha filha está com tosse, me ajuda?')).toBe('clinica')
    expect(recusaLocal('Estou com dor de cabeça, é grave?')).toBe('clinica')
  })

  it('recusa outras formas de pedido de conselho clinico', () => {
    expect(recusaLocal('Qual remédio serve para dor de garganta?')).toBe('clinica')
    expect(recusaLocal('Tenho alergia, posso tomar loratadina?')).toBe('clinica')
    expect(recusaLocal('Minha mãe está com pressão alta, o que devo dar?')).toBe('clinica')
    expect(recusaLocal('Estou com tosse, qual xarope é bom?')).toBe('clinica')
    expect(recusaLocal('Qual a dose de dipirona para criança?')).toBe('clinica')
    expect(recusaLocal('Meu filho está com diarreia, o que eu faço?')).toBe('clinica')
    expect(recusaLocal('Estou com dor nas costas, é grave?')).toBe('clinica')
    expect(recusaLocal('Pode tomar ibuprofeno com estômago vazio?')).toBe('clinica')
    expect(recusaLocal('Estou gripado, preciso tomar antibiótico?')).toBe('clinica')
  })

  it('NAO recusa consulta gerencial com substantivo de produto', () => {
    expect(recusaLocal('Quais medicamentos estão parados?')).toBeNull()
    expect(recusaLocal('Quais remédios mais venderam?')).toBeNull()
    expect(recusaLocal('O que preciso repor no estoque?')).toBeNull()
    expect(recusaLocal('Como foram as vendas de hoje?')).toBeNull()
    expect(recusaLocal('Quais produtos estão em falta no estoque?')).toBeNull()
    expect(recusaLocal('Quantos medicamentos foram vendidos hoje?')).toBeNull()
    expect(recusaLocal('Qual remédio vendeu mais no mês passado?')).toBeNull()
    expect(recusaLocal('Tem dipirona no estoque?')).toBeNull()
  })

  it('NAO recusa as outras consultas gerenciais do catalogo', () => {
    expect(recusaLocal('Quantos medicamentos venceram este mês?')).toBeNull()
    expect(recusaLocal('Meu estoque de amoxicilina está baixo?')).toBeNull()
    expect(recusaLocal('Qual produto parado tem mais unidades?')).toBeNull()
    expect(recusaLocal('Quantas unidades de paracetamol venderam hoje?')).toBeNull()
    expect(recusaLocal('Quais os 10 produtos mais vendidos?')).toBeNull()
    expect(recusaLocal('Tem 3 caixas de dipirona no estoque?')).toBeNull()
    expect(recusaLocal('As vendas de hoje foram melhores que as de ontem?')).toBeNull()
  })

  // Achado Important 1 do revisor: frases GENERICAS de portugues ("me ajuda",
  // "o que eu faco", "preciso tomar") disparavam sozinhas, sem nenhuma ancora
  // clinica. Estas dez foram recusadas como `clinica` na versao anterior — a
  // primeira e a terceira sao as intencoes canonicas `vendas_dia` e
  // `estoque_baixo`.
  it('NAO recusa pedido de ajuda ou imperativo de negocio (as dez do revisor)', () => {
    expect(recusaLocal('Me ajuda a ver as vendas de hoje')).toBeNull()
    expect(recusaLocal('O que eu faço para repor o estoque?')).toBeNull()
    expect(recusaLocal('Me ajuda a ver o estoque baixo')).toBeNull()
    expect(recusaLocal('O que eu faço com os produtos parados?')).toBeNull()
    expect(recusaLocal('Preciso tomar alguma decisão sobre o estoque parado?')).toBeNull()
    expect(recusaLocal('Devo tomar cuidado com produtos vencidos?')).toBeNull()
    expect(recusaLocal('Posso dar baixa no estoque vencido?')).toBeNull()
    expect(recusaLocal('Faz mal ter estoque parado?')).toBeNull()
    expect(recusaLocal('Pode tomar decisões de compra com base no estoque baixo?')).toBeNull()
    expect(recusaLocal('Posso dar desconto numa venda?')).toBeNull()
  })

  it('NAO recusa as variantes dessa mesma classe', () => {
    expect(recusaLocal('Posso dar desconto?')).toBeNull()
    expect(recusaLocal('Devo tomar cuidado com o estoque?')).toBeNull()
    expect(recusaLocal('O que eu faço para vender mais?')).toBeNull()
    expect(recusaLocal('Me ajuda a entender o relatório')).toBeNull()
    expect(recusaLocal('Preciso tomar uma decisão sobre a compra')).toBeNull()
    expect(recusaLocal('Pode tomar providências sobre o estoque?')).toBeNull()
    expect(recusaLocal('O que eu posso fazer para reduzir o estoque parado?')).toBeNull()
    expect(recusaLocal('Posso dar um jeito no estoque?')).toBeNull()
    expect(recusaLocal('Quero saber quanto de dipirona tem no estoque')).toBeNull()
    expect(recusaLocal('Qual a quantidade de amoxicilina em estoque?')).toBeNull()
    expect(recusaLocal('Como estão as vendas do remédio X?')).toBeNull()
  })

  it('recusa a ancora clinica com pedido de ajuda, mesmo com outro assunto na frase', () => {
    // O pedido de ajuda generico passa a valer SO com ancora clinica. "meu filho
    // com febre" e a ancora; a frase termina pedindo para "ver" outra coisa, e
    // isso nao transforma o pedido de ajuda em pedido gerencial.
    expect(recusaLocal('Estou com febre, me ajuda a ver as vendas?')).toBe('clinica')
    expect(recusaLocal('Meu filho está com febre, me ajuda?')).toBe('clinica')
    expect(recusaLocal('Estou com dor, o que eu faço?')).toBe('clinica')
  })

  it('ancora clinica do caminho por medicamento e dose continua valendo', () => {
    expect(recusaLocal('Posso dar dipirona para meu filho de 3 anos?')).toBe('clinica')
    expect(recusaLocal('Qual remédio é bom para pressão alta?')).toBe('clinica')
    expect(recusaLocal('Qual a posologia da amoxicilina?')).toBe('clinica')
    expect(recusaLocal('Preciso tomar dipirona para dor?')).toBe('clinica')
    expect(recusaLocal('Posso tomar amoxicilina?')).toBe('clinica')
    expect(recusaLocal('Devo tomar paracetamol?')).toBe('clinica')
  })

  // Estes dois apareceram na sondagem do proprio filtro depois do Important 1:
  // "o que tomar?" sem o "posso" e a doenca no lugar do sintoma.
  it('recusa a doenca e o "o que tomar" sem o verbo modal', () => {
    expect(recusaLocal('Tenho infecção de urina, o que tomar?')).toBe('clinica')
    expect(recusaLocal('Qual o melhor remédio para gripe?')).toBe('clinica')
    expect(recusaLocal('Tenho inflamação na garganta, é grave?')).toBe('clinica')
  })

  it('NAO recusa consulta de estoque com medicamento e quantidade', () => {
    expect(recusaLocal('Quero saber quanto de dipirona tem no estoque')).toBeNull()
    expect(recusaLocal('Qual a quantidade de amoxicilina em estoque?')).toBeNull()
    expect(recusaLocal('Como estão as vendas do remédio X?')).toBeNull()
  })

  // Fix round 2: a lista de exclusao do PEDIDO_DE_MEDICAR excluia o VERBO, entao
  // bastava a palavra da lista depois de "dar" para o pedido clinico inteiro ser
  // ignorado. O modo de falha e o pior deste filtro: ACEITAR pergunta de saude.
  it('recusa o pedido clinico que usa uma palavra da lista de negocio', () => {
    expect(recusaLocal('Posso dar baixa na febre do meu filho com dipirona?')).toBe('clinica')
    expect(recusaLocal('Posso dar baixa na dipirona do meu filho?')).toBe('clinica')
    expect(recusaLocal('Posso dar entrada no hospital com dor no peito?')).toBe('clinica')
  })

  it('recusa outras frases da mesma classe (sondagem do fix round 2)', () => {
    expect(recusaLocal('Posso dar baixa na dor de cabeça do meu filho?')).toBe('clinica')
    expect(recusaLocal('Posso dar entrada no hospital com febre?')).toBe('clinica')
    expect(recusaLocal('Posso dar uma olhada na dose da amoxicilina?')).toBe('clinica')
    expect(recusaLocal('Preciso de uma olhada na posologia do xarope')).toBe('clinica')
    expect(recusaLocal('Devo tomar uma medida para a dor?')).toBe('clinica')
    // NAO e clinica: e o achado 1 do fix round 4. "dar desconto na dipirona" e o
    // desconto comercial no produto, e a base `4d18667` sempre aceitou.
    expect(recusaLocal('Posso dar desconto na dipirona?')).toBeNull()
    expect(recusaLocal('Posso dar baixa na tosse do meu filho?')).toBe('clinica')
  })

  // Os tres buracos que a re-sondagem da classe achou depois da primeira correcao:
  // o verbo nao era "dar/tomar", o conector "para a" engolia o artigo e o destino
  // hospitalar vinha separado por "com".
  it('recusa a mesma classe quando o verbo nao e dar/tomar ou o conector muda', () => {
    expect(recusaLocal('Preciso de uma medida de dipirona para criança')).toBe('clinica')
    expect(recusaLocal('Qual a providência para a dor de cabeça?')).toBe('clinica')
    expect(recusaLocal('Posso dar entrada no hospital com o bebê?')).toBe('clinica')
    expect(recusaLocal('Qual a decisão sobre a dose do remédio?')).toBe('clinica')
    expect(recusaLocal('Posso dar entrada na emergência com pressão alta?')).toBe('clinica')
    expect(recusaLocal('Qual a medida de xarope para tosse?')).toBe('clinica')
    expect(recusaLocal('Quero uma olhada na dose de amoxicilina para infecção')).toBe('clinica')
  })

  // A outra metade: os objetos de NEGOCIO da mesma lista nao podem voltar a
  // recusar. Frases confirmadas pelo revisor.
  it('NAO recusa o objeto de negocio da mesma lista (nao pode regredir)', () => {
    expect(recusaLocal('Posso dar baixa no estoque vencido?')).toBeNull()
    expect(recusaLocal('Posso dar entrada na nota fiscal hoje?')).toBeNull()
    expect(recusaLocal('Como dar entrada de mercadoria no sistema?')).toBeNull()
    expect(recusaLocal('Me ajuda a dar baixa no estoque vencido')).toBeNull()
    expect(recusaLocal('Me dá uma olhada nas vendas de ontem')).toBeNull()
    expect(recusaLocal('Qual a providência para o estoque parado?')).toBeNull()
    expect(recusaLocal('Qual a decisão certa sobre o estoque baixo?')).toBeNull()
    expect(recusaLocal('Preciso de uma olhada no relatório de vendas')).toBeNull()
    expect(recusaLocal('Devo tomar uma atitude sobre os produtos vencidos?')).toBeNull()
    expect(recusaLocal('Faz mal deixar estoque parado?')).toBeNull()
    expect(recusaLocal('Poderia dar uma olhada no relatório?')).toBeNull()
    expect(recusaLocal('Posso dar desconto numa venda?')).toBeNull()
    expect(recusaLocal('Como dar entrada de nota no caixa?')).toBeNull()
    expect(recusaLocal('Posso dar uma olhada no estoque baixo?')).toBeNull()
    expect(recusaLocal('Preciso de uma medida para o estoque parado')).toBeNull()
  })
})
describe('recusaLocal — PII', () => {
  it('recusa CPF, telefone e e-mail reconheciveis', () => {
    expect(recusaLocal('O CPF 123.456.789-09 tem dívida?')).toBe('pessoal')
    expect(recusaLocal('O CPF 12345678909 tem dívida?')).toBe('pessoal')
    expect(recusaLocal('Meu telefone é (11) 98765-4321, pode me ligar?')).toBe('pessoal')
    expect(recusaLocal('Ligue para 11 98765-4321')).toBe('pessoal')
    expect(recusaLocal('Manda no email lucas@farmacia.local')).toBe('pessoal')
    expect(recusaLocal('meu whatsapp 11987654321')).toBe('pessoal')
    expect(recusaLocal('email: a.b+c@x.com.br')).toBe('pessoal')
  })

  it('NAO recusa data, quantidade nem valor em dinheiro', () => {
    expect(recusaLocal('Como foram as vendas de 01/10/2026 a 05/10/2026?')).toBeNull()
    expect(recusaLocal('Quais foram as vendas do dia 2026-10-09?')).toBeNull()
    expect(recusaLocal('Vendas de hoje, quero 10 produtos')).toBeNull()
    expect(recusaLocal('Qual foi o total de 1.234,56 em vendas?')).toBeNull()
    expect(recusaLocal('Quantas vendas de 01/01/2026 ate 31/01/2026?')).toBeNull()
  })

  it('a clinica tem prioridade quando o texto tem os dois', () => {
    expect(recusaLocal('Estou com dor de cabeça, o que posso tomar? Meu CPF é 123.456.789-09'))
      .toBe('clinica')
  })
})

describe('validarClassificacao — JSON valido', () => {
  it('aceita as quatro intencoes e fora_escopo', () => {
    expect(validarClassificacao({ intencao: 'vendas_dia' }, HOJE)).toEqual({
      intencao: 'vendas_dia',
      de: HOJE,
      ate: HOJE,
    })
    expect(validarClassificacao({ intencao: 'mais_vendidos' }, HOJE)).toEqual({
      intencao: 'mais_vendidos',
      limite: LIMITE_RESULTADOS,
    })
    expect(validarClassificacao({ intencao: 'estoque_baixo' }, HOJE)).toEqual({
      intencao: 'estoque_baixo',
      limite: LIMITE_RESULTADOS,
    })
    expect(validarClassificacao({ intencao: 'estoque_parado' }, HOJE)).toEqual({
      intencao: 'estoque_parado',
      limite: LIMITE_RESULTADOS,
    })
    expect(validarClassificacao({ intencao: 'fora_escopo' }, HOJE)).toEqual({ intencao: 'fora_escopo' })
  })

  it('aceita o objeto com as quatro chaves, nulas e preenchidas', () => {
    expect(
      validarClassificacao({ intencao: 'vendas_dia', de: '2026-10-01', ate: '2026-10-05', limite: null }, HOJE),
    ).toEqual({ intencao: 'vendas_dia', de: '2026-10-01', ate: '2026-10-05' })

    expect(
      validarClassificacao({ intencao: 'mais_vendidos', de: null, ate: null, limite: 5 }, HOJE),
    ).toEqual({ intencao: 'mais_vendidos', limite: 5 })
  })

  it('aceita a string de conteudo do modelo', () => {
    expect(validarClassificacao('{"intencao":"estoque_baixo","de":null,"ate":null,"limite":3}', HOJE)).toEqual({
      intencao: 'estoque_baixo',
      limite: 3,
    })

    expect(validarClassificacao('  {"intencao":"fora_escopo"}  ', HOJE)).toEqual({ intencao: 'fora_escopo' })
  })

  it('aplica o padrao de hoje quando de e ate sao nulos', () => {
    expect(validarClassificacao({ intencao: 'vendas_dia', de: null, ate: null }, HOJE)).toEqual({
      intencao: 'vendas_dia',
      de: HOJE,
      ate: HOJE,
    })
    expect(validarClassificacao({ intencao: 'vendas_dia' }, HOJE)).toEqual({
      intencao: 'vendas_dia',
      de: HOJE,
      ate: HOJE,
    })
  })

  it('aceita o intervalo inclusive de exatamente 31 dias', () => {
    // 2026-10-01 a 2026-10-31 sao 31 dias contando as duas pontas.
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2026-10-01', ate: '2026-10-31' }, HOJE)).toEqual({
      intencao: 'vendas_dia',
      de: '2026-10-01',
      ate: '2026-10-31',
    })
  })

  it('aceita o mesmo dia nas duas pontas', () => {
    expect(validarClassificacao({ intencao: 'vendas_dia', de: HOJE, ate: HOJE }, HOJE)).toEqual({
      intencao: 'vendas_dia',
      de: HOJE,
      ate: HOJE,
    })
  })
})

describe('validarClassificacao — recusas', () => {
  it('recusa string que nao e JSON valido', () => {
    expect(validarClassificacao('', HOJE)).toBeNull()
    expect(validarClassificacao('nao é json', HOJE)).toBeNull()
    expect(validarClassificacao('{"intencao":', HOJE)).toBeNull()
    expect(validarClassificacao('```json\n{"intencao":"vendas_dia"}\n```', HOJE)).toBeNull()
    expect(validarClassificacao('[1,2,3]', HOJE)).toBeNull()
    expect(validarClassificacao('null', HOJE)).toBeNull()
    expect(validarClassificacao('"vendas_dia"', HOJE)).toBeNull()
  })

  it('recusa nulo, indefinido, array e primitivos', () => {
    expect(validarClassificacao(null, HOJE)).toBeNull()
    expect(validarClassificacao(undefined, HOJE)).toBeNull()
    expect(validarClassificacao([], HOJE)).toBeNull()
    expect(validarClassificacao(7, HOJE)).toBeNull()
    expect(validarClassificacao(true, HOJE)).toBeNull()
  })

  it('recusa qualquer chave a mais', () => {
    expect(validarClassificacao({ intencao: 'vendas_dia', sql: 'select 1' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'vendas_dia', periodo: 'outubro' }, HOJE)).toBeNull()
    expect(
      validarClassificacao(
        { intencao: 'mais_vendidos', de: null, ate: null, limite: 5, extra: true },
        HOJE,
      ),
    ).toBeNull()
  })

  it('recusa intencao fora do enum, ausente ou de outro tipo', () => {
    expect(validarClassificacao({ intencao: 'lucro' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'VENDAS_DIA' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'fora-escopo' }, HOJE)).toBeNull()
    expect(validarClassificacao({}, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 3 }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: null }, HOJE)).toBeNull()
  })

  it('recusa data de calendario inexistente ou fora do formato', () => {
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2026-02-30', ate: '2026-03-01' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2026-13-01', ate: '2026-13-02' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '01/10/2026', ate: '05/10/2026' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2026-10-9', ate: '2026-10-10' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'vendas_dia', de: 20261001, ate: 20261005 }, HOJE)).toBeNull()
  })

  it('recusa intervalo invertido ou maior que 31 dias', () => {
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2026-10-05', ate: '2026-10-01' }, HOJE)).toBeNull()
    // 2026-10-01 a 2026-11-01 sao 32 dias.
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2026-10-01', ate: '2026-11-01' }, HOJE)).toBeNull()
  })

  it('recusa quando so uma das pontas vem preenchida', () => {
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2026-10-01', ate: null }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'vendas_dia', de: null, ate: '2026-10-05' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2026-10-01' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'vendas_dia', ate: '2026-10-05' }, HOJE)).toBeNull()
  })

  // Achado Important 2 do revisor: `validarDia` trata string vazia como "hoje,
  // sem aviso" — correto para parametro de URL, ERRADO para o JSON do modelo.
  // `''` nao e data de calendario: e recusa.
  it('recusa string vazia nas pontas em vez de virar hoje', () => {
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '', ate: '2026-10-20' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2026-10-01', ate: '' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '', ate: '' }, HOJE)).toBeNull()
    expect(validarClassificacao('{"intencao":"vendas_dia","de":"","ate":""}', HOJE)).toBeNull()
    // Espaco em branco tambem nao e data.
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '   ', ate: '2026-10-20' }, HOJE)).toBeNull()
  })

  // Achado Important 3 do revisor: o intervalo vem do modelo, e a contagem dia a
  // dia percorria milhares de anos de CPU SINCRONA antes de recusar (~8,9 s para
  // 0000-01-01..9999-12-31). Estes testes sao a rede: se alguem voltar a contar
  // num laco, o tempo estoura e o teste falha.
  it('recusa intervalo absurdo em tempo desprezivel', () => {
    const comeco = performance.now()
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '0000-01-01', ate: '9999-12-31' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '0000-01-01', ate: HOJE }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'vendas_dia', de: HOJE, ate: '9999-12-31' }, HOJE)).toBeNull()
    const decorrido = performance.now() - comeco

    // Antes: ~8,9 s so no primeiro caso. Agora os tres juntos ficam na casa de
    // microssegundos; 200 ms e folga de sobra para uma maquina carregada.
    expect(decorrido).toBeLessThan(200)
  })

  it('o corte de 31 dias e exato nas bordas do intervalo', () => {
    // 31 dias passa, 32 recusa — inclusive atravessando mes e ano.
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2026-01-01', ate: '2026-01-31' }, HOJE)).toEqual({
      intencao: 'vendas_dia',
      de: '2026-01-01',
      ate: '2026-01-31',
    })
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2026-01-01', ate: '2026-02-01' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2026-12-15', ate: '2027-01-14' }, HOJE)).toEqual({
      intencao: 'vendas_dia',
      de: '2026-12-15',
      ate: '2027-01-14',
    })
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2026-12-15', ate: '2027-01-15' }, HOJE)).toBeNull()
    // Ano bissexto: 2024-02-01 a 2024-03-02 sao 31 dias.
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2024-02-01', ate: '2024-03-02' }, HOJE)).toEqual({
      intencao: 'vendas_dia',
      de: '2024-02-01',
      ate: '2024-03-02',
    })
    expect(validarClassificacao({ intencao: 'vendas_dia', de: '2024-02-01', ate: '2024-03-03' }, HOJE)).toBeNull()
  })

  it('recusa periodo nas tres views que nao filtram data', () => {
    for (const intencao of ['mais_vendidos', 'estoque_baixo', 'estoque_parado'] as const) {
      expect(validarClassificacao({ intencao, de: '2026-10-01', ate: '2026-10-05' }, HOJE)).toBeNull()
      expect(validarClassificacao({ intencao, de: '2026-10-01', ate: null }, HOJE)).toBeNull()
      expect(validarClassificacao({ intencao, de: null, ate: '2026-10-05' }, HOJE)).toBeNull()
      // Nulo nas duas pontas continua sendo aceito: nao ha periodo nenhum.
      expect(validarClassificacao({ intencao, de: null, ate: null }, HOJE)).toEqual({
        intencao,
        limite: LIMITE_RESULTADOS,
      })
    }
  })

  it('recusa limite fora de 1..10, nao-inteiro ou numero em texto', () => {
    expect(validarClassificacao({ intencao: 'mais_vendidos', limite: 0 }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'mais_vendidos', limite: 11 }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'mais_vendidos', limite: -1 }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'mais_vendidos', limite: 2.5 }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'mais_vendidos', limite: '5' }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'mais_vendidos', limite: NaN }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'mais_vendidos', limite: Infinity }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'mais_vendidos', limite: -Infinity }, HOJE)).toBeNull()
    expect(validarClassificacao({ intencao: 'mais_vendidos', limite: null }, HOJE)).toEqual({
      intencao: 'mais_vendidos',
      limite: LIMITE_RESULTADOS,
    })
    expect(validarClassificacao({ intencao: 'mais_vendidos', limite: 1 }, HOJE)).toEqual({
      intencao: 'mais_vendidos',
      limite: 1,
    })
    expect(validarClassificacao({ intencao: 'mais_vendidos', limite: 10 }, HOJE)).toEqual({
      intencao: 'mais_vendidos',
      limite: 10,
    })
  })

  it('aceita limite nulo em texto e recusa numero em texto', () => {
    expect(validarClassificacao('{"intencao":"mais_vendidos","limite":null}', HOJE)).toEqual({
      intencao: 'mais_vendidos',
      limite: LIMITE_RESULTADOS,
    })
    expect(validarClassificacao('{"intencao":"mais_vendidos","limite":"5"}', HOJE)).toBeNull()
  })
})

describe('custoMicros', () => {
  it('usa as tarifas maximas e arredonda para cima', () => {
    // 1.000 de entrada x 0,30/1e6 = 300 micros exatos.
    expect(custoMicros({ prompt_tokens: 1000, completion_tokens: 0 })).toBe(300)
    // 10.000 de entrada = 3.000 micros exatos.
    expect(custoMicros({ prompt_tokens: 10_000, completion_tokens: 0 })).toBe(3_000)
    // 100 de saida x 1,20/1e6 = 120 micros exatos.
    expect(custoMicros({ prompt_tokens: 0, completion_tokens: 100 })).toBe(120)
    // 123.457 de entrada + 321 de saida = 37.422,3 micros -> 37.423.
    expect(custoMicros({ prompt_tokens: 123_457, completion_tokens: 321 })).toBe(37_423)
  })

  it('nunca arredonda para baixo nem subcobra', () => {
    // 1 token de entrada + 1 de saida = 1,5 micros: arredondar para baixo daria
    // 1 e o contador ficaria devendo; o certo e subir.
    const custo = custoMicros({ prompt_tokens: 1, completion_tokens: 1 })
    expect(custo).toBe(2)
    expect(custo).toBeGreaterThanOrEqual(
      (1 * TARIFA_ENTRADA_MICROS_POR_MILHAO + 1 * TARIFA_SAIDA_MICROS_POR_MILHAO) / 1_000_000,
    )

    for (const uso of [
      { prompt_tokens: 1, completion_tokens: 0 },
      { prompt_tokens: 0, completion_tokens: 1 },
      { prompt_tokens: 3, completion_tokens: 7 },
      { prompt_tokens: 123_457, completion_tokens: 321 },
    ]) {
      const exato =
        (uso.prompt_tokens * TARIFA_ENTRADA_MICROS_POR_MILHAO +
          uso.completion_tokens * TARIFA_SAIDA_MICROS_POR_MILHAO) /
        1_000_000
      expect(custoMicros(uso)).toBe(Math.ceil(exato))
    }
  })

  it('devolve 0 quando o uso nao veio', () => {
    expect(custoMicros(null)).toBe(0)
    expect(custoMicros(undefined)).toBe(0)
    expect(custoMicros({ prompt_tokens: 0, completion_tokens: 0 })).toBe(0)
  })

  it('nao passa da reserva maxima com os limites do plano', () => {
    const noLimite = custoMicros({
      prompt_tokens: TOKENS_ENTRADA_RESERVA,
      completion_tokens: MAX_TOKENS_SAIDA,
    })
    expect(noLimite).toBe(RESERVA_MICROS)
  })
})

describe('mesSaoPaulo', () => {
  it('devolve o primeiro dia do mes de Sao Paulo', () => {
    expect(mesSaoPaulo(new Date('2026-10-09T15:00:00Z'))).toBe('2026-10-01')
    expect(mesSaoPaulo(new Date('2026-01-15T12:00:00Z'))).toBe('2026-01-01')
  })

  it('nao adianta o mes para quem ja esta no dia 1 em Sao Paulo', () => {
    // 01/10/2026 00:30 em SP = 01/10/2026 03:30 UTC.
    expect(mesSaoPaulo(new Date('2026-10-01T03:30:00Z'))).toBe('2026-10-01')
    // 31/10/2026 22:30 em SP = 01/11/2026 01:30 UTC: ainda e outubro em SP.
    expect(mesSaoPaulo(new Date('2026-11-01T01:30:00Z'))).toBe('2026-10-01')
    // 30/11/2026 23:30 em SP = 01/12/2026 02:30 UTC: ainda e novembro em SP.
    expect(mesSaoPaulo(new Date('2026-12-01T02:30:00Z'))).toBe('2026-11-01')
  })
})

describe('montarResposta', () => {
  it('monta as vendas por dia em centavos formatados por lib/format.ts', () => {
    const texto = montarResposta({
      intencao: 'vendas_dia',
      linhas: [
        { dia: '2026-10-08', quantidade: 3, total: 15050, ticket_medio: 5017 },
        { dia: '2026-10-09', quantidade: 1, total: 900, ticket_medio: 900 },
      ],
    })

    expect(texto).toContain('08/10/2026')
    expect(texto).toContain('09/10/2026')
    expect(texto).toContain('R$ 150,50')
    expect(texto).toContain('R$ 50,17')
    expect(texto).toContain('R$ 9,00')
    expect(texto).toContain('3')
    expect(texto).toContain('1')
  })

  it('formata a data do Postgres sem perder um dia (R16)', () => {
    const texto = montarResposta({
      intencao: 'vendas_dia',
      linhas: [{ dia: '2026-10-09', quantidade: 1, total: 1000, ticket_medio: 1000 }],
    })

    // formatarData('2026-10-09') devolve 08/10/2026 (meia-noite UTC cai para o
    // dia anterior em Sao Paulo). O dia civil do Postgres tem que sair inteiro.
    expect(texto).toContain('09/10/2026')
    expect(texto).not.toContain('08/10/2026')
  })

  it('monta os mais vendidos com nome e quantidade', () => {
    const texto = montarResposta({
      intencao: 'mais_vendidos',
      linhas: [
        { nome: 'Dipirona 500mg', quantidade: 42 },
        { nome: 'Paracetamol 750mg', quantidade: 17 },
      ],
    })

    expect(texto).toContain('Dipirona 500mg')
    expect(texto).toContain('42')
    expect(texto).toContain('Paracetamol 750mg')
    expect(texto).toContain('17')
  })

  it('monta estoque baixo e estoque parado com o estoque atual', () => {
    const baixo = montarResposta({
      intencao: 'estoque_baixo',
      linhas: [{ nome: 'Amoxicilina 500mg', estoque_atual: 2 }],
    })
    expect(baixo).toContain('Amoxicilina 500mg')
    expect(baixo).toContain('2')

    const parado = montarResposta({
      intencao: 'estoque_parado',
      linhas: [{ nome: 'Ibuprofeno 400mg', estoque_atual: 9 }],
    })
    expect(parado).toContain('Ibuprofeno 400mg')
    expect(parado).toContain('9')
  })

  it('devolve mensagem fixa em portugues quando nao ha linha', () => {
    const vazio = montarResposta({ intencao: 'vendas_dia', linhas: [] })
    const vazioMais = montarResposta({ intencao: 'mais_vendidos', linhas: [] })

    expect(vazio.length).toBeGreaterThan(0)
    expect(vazioMais.length).toBeGreaterThan(0)
    expect(vazio).not.toBe(vazioMais)

    for (const texto of [
      vazio,
      vazioMais,
      montarResposta({ intencao: 'estoque_baixo', linhas: [] }),
      montarResposta({ intencao: 'estoque_parado', linhas: [] }),
    ]) {
      expect(texto).toMatch(/n[aã]o|nenhum|sem /i)
    }
  })
})

describe('mensagemRecusa', () => {
  it('tem texto curto em portugues para cada motivo', () => {
    const motivos = ['vazia', 'longa', 'payload', 'clinica', 'pessoal', 'classificacao'] as const
    const vistos = new Set<string>()

    for (const motivo of motivos) {
      const texto = mensagemRecusa(motivo)
      expect(typeof texto).toBe('string')
      expect(texto.length).toBeGreaterThan(10)
      expect(texto.length).toBeLessThan(300)
      expect(vistos.has(texto)).toBe(false)
      vistos.add(texto)
    }

    expect(mensagemRecusa('clinica')).toMatch(/m[eé]dic|sa[uú]de|cl[ií]nic|profissional/i)
    expect(mensagemRecusa('pessoal')).toMatch(/CPF|telefone|e-?mail|dado/i)
    expect(mensagemRecusa('classificacao')).toMatch(/entendi|reformul|pergunt/i)
    expect(mensagemRecusa('longa')).toContain(String(LIMITE_PERGUNTA))
  })
})
