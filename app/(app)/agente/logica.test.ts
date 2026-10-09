import { describe, it, expect } from 'vitest'
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

  it('o limite de payload e maior que o pior caso do limite de caracteres', () => {
    // 500 caracteres de 4 bytes (emoji) = 2.000 bytes: o teto de bytes nunca
    // dispara por tamanho de pergunta. Ele e guarda de fronteira do payload de
    // mensagens, e o motivo 'payload' existe para quando a rota mudar o formato.
    expect(LIMITE_PAYLOAD_BYTES).toBeGreaterThan(LIMITE_PERGUNTA * 4)
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
