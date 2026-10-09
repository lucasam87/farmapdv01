import { describe, it, expect } from 'vitest'
import { proximoEnvio, respostaAindaVale, type Envio } from './corrida'

// Important 1 do round 1: a resposta de um envio antigo nao pode ser renderizada
// embaixo de um campo que ja mostra outra pergunta. O campo e os exemplos seguem
// habilitados durante o carregamento, entao a corrida e alcancavel pelo usuario.

describe('proximoEnvio', () => {
  it('numera os envios em sequencia, guardando o texto enviado', () => {
    const primeiro = proximoEnvio(null, 'Como foram as vendas de hoje?')
    const segundo = proximoEnvio(primeiro, 'Quais produtos mais venderam?')

    expect(primeiro).toEqual({ id: 1, pergunta: 'Como foram as vendas de hoje?' })
    expect(segundo).toEqual({ id: 2, pergunta: 'Quais produtos mais venderam?' })
  })
})

describe('respostaAindaVale', () => {
  it('aceita a resposta do envio atual quando o campo continua com a mesma pergunta', () => {
    const envio = proximoEnvio(null, 'Como foram as vendas de hoje?')

    expect(respostaAindaVale(envio, envio, 'Como foram as vendas de hoje?')).toBe(true)
  })

  it('descarta a resposta que chega depois de o usuario digitar outra pergunta', () => {
    const envio = proximoEnvio(null, 'A')

    expect(respostaAindaVale(envio, envio, 'B')).toBe(false)
  })

  it('descarta a resposta que chega depois de o usuario clicar num exemplo', () => {
    const envio = proximoEnvio(null, 'Como foram as vendas de hoje?')

    expect(
      respostaAindaVale(envio, envio, 'Quais produtos estão parados?'),
    ).toBe(false)
  })

  it('descarta a resposta de um envio antigo quando ja existe um envio mais novo', () => {
    const antigo = proximoEnvio(null, 'A')
    const novo = proximoEnvio(antigo, 'B')

    expect(respostaAindaVale(antigo, novo, 'A')).toBe(false)
    expect(respostaAindaVale(antigo, novo, 'B')).toBe(false)
    expect(respostaAindaVale(novo, novo, 'B')).toBe(true)
  })

  it('descarta resposta orfa, sem nenhum envio atual', () => {
    const envio = proximoEnvio(null, 'A')

    expect(respostaAindaVale(envio, null, 'A')).toBe(false)
  })

  it('aceita de novo quando o texto volta a ser o que foi enviado', () => {
    const envio = proximoEnvio(null, 'A')

    expect(respostaAindaVale(envio, envio, 'A')).toBe(true)
  })

  it('reproduz a corrida do revisor: a resposta de A nao aparece embaixo do campo B', () => {
    // O que a tela mostra e o que esta "no campo", na ordem dos acontecimentos.
    let naTela = ''
    let atual: Envio | null = null

    // 1. o usuario digita A e envia
    naTela = 'Como foram as vendas de hoje?'
    atual = proximoEnvio(atual, naTela)
    const envioA = atual

    // 2. enquanto o POST esta em voo, digita B (o campo segue habilitado)
    naTela = 'Quais produtos mais venderam?'

    // 3. a resposta de A chega: NAO pode escrever na tela
    expect(respostaAindaVale(envioA, atual, naTela)).toBe(false)

    // 4. o usuario envia B; a resposta de B chega: essa sim aparece
    atual = proximoEnvio(atual, naTela)
    const envioB = atual
    expect(respostaAindaVale(envioB, atual, naTela)).toBe(true)

    // 5. e a de A, se chegasse ainda mais tarde, continua descartada
    expect(respostaAindaVale(envioA, atual, naTela)).toBe(false)
  })
})
