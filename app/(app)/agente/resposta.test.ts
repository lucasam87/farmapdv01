import { describe, it, expect } from 'vitest'
import { ERRO_INESPERADO, ERRO_REDE, lerRespostaAgente } from './resposta'

// A fronteira que a tela nao pode errar: o que o POST /api/agente devolve vira o
// que o atendente le. Os textos de sucesso e de recusa sao do SERVIDOR (R6) — o
// cliente so os repassa. O que este teste fixa:
//   1. `{resposta}` de 200 aparece como resposta;
//   2. `{erro}` de qualquer recusa aparece como erro, com o texto intacto;
//   3. corpo vazio, torto ou fora do contrato NAO vira tela em branco nem saida
//      crua do modelo: vira a mensagem fixa em portugues;
//   4. nada aqui nomeia view, prompt, chave ou provedor.

describe('lerRespostaAgente', () => {
  it('mostra a resposta montada pelo servidor no 200', () => {
    expect(lerRespostaAgente(true, { resposta: 'Vendas por dia\nTotal: 3 vendas e R$ 90,00' })).toEqual({
      tipo: 'resposta',
      texto: 'Vendas por dia\nTotal: 3 vendas e R$ 90,00',
    })
  })

  it('preserva as quebras de linha da resposta', () => {
    const resultado = lerRespostaAgente(true, { resposta: 'linha 1\nlinha 2' })
    expect(resultado.tipo).toBe('resposta')
    expect(resultado.texto).toContain('\n')
  })

  it('repassa o erro do servidor sem reescrever, em cada recusa da R6', () => {
    const casos = [
      [401, 'Faça login para usar o assistente.'],
      [403, 'Seu perfil não tem acesso ao assistente.'],
      [400, 'Escreva uma pergunta sobre vendas ou estoque da farmacia.'],
      [429, 'O limite mensal do assistente foi atingido. Tente novamente no próximo mês.'],
      [500, 'Não foi possível ler os dados agora. Tente novamente em instantes.'],
      [502, 'O assistente está indisponível agora. Tente novamente em instantes.'],
    ] as const

    for (const [, mensagem] of casos) {
      expect(lerRespostaAgente(false, { erro: mensagem })).toEqual({ tipo: 'erro', texto: mensagem })
    }
  })

  it('mostra o erro e nao a resposta quando a resposta HTTP nao e ok', () => {
    expect(lerRespostaAgente(false, { resposta: 'texto que nao deve aparecer', erro: 'falhou' })).toEqual({
      tipo: 'erro',
      texto: 'falhou',
    })
  })

  it('nao inventa resposta quando o 200 vem vazio, em branco ou sem string', () => {
    const corpos: unknown[] = [
      { resposta: '' },
      { resposta: '   ' },
      { resposta: 42 },
      { resposta: null },
      {},
      null,
      undefined,
      'resposta crua',
      [],
      ['resposta'],
    ]

    for (const corpo of corpos) {
      expect(lerRespostaAgente(true, corpo)).toEqual({ tipo: 'erro', texto: ERRO_INESPERADO })
    }
  })

  it('nao mostra a saida crua do modelo nem nome de view', () => {
    const saidaDoModelo = {
      choices: [{ message: { content: '{"intencao":"vendas_dia"}' } }],
      usage: { prompt_tokens: 900, completion_tokens: 12 },
    }
    const resultado = lerRespostaAgente(true, saidaDoModelo)

    expect(resultado).toEqual({ tipo: 'erro', texto: ERRO_INESPERADO })
    expect(resultado.texto).not.toContain('intencao')
    expect(resultado.texto).not.toContain('choices')
  })

  it('nao devolve texto vazio em nenhuma entrada', () => {
    const entradas: unknown[] = [null, undefined, 0, '', {}, { resposta: '' }, { erro: '' }, { erro: 'ok' }]

    for (const ok of [true, false]) {
      for (const entrada of entradas) {
        expect(lerRespostaAgente(ok, entrada).texto.trim()).not.toBe('')
      }
    }
  })

  it('as mensagens escritas na tela sao curtas e sem jargao interno', () => {
    for (const mensagem of [ERRO_REDE, ERRO_INESPERADO]) {
      expect(mensagem.trim()).not.toBe('')
      for (const proibido of ['view', 'select', 'prompt', 'deepseek', 'token', 'undefined', 'Error']) {
        expect(mensagem.toLowerCase()).not.toContain(proibido.toLowerCase())
      }
    }
  })
})
