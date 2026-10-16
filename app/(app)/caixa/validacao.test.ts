import { describe, it, expect } from 'vitest'
import { validarValorInicial, validarMovimento, validarFechamento, validarPapelFechamento } from './validacao'

// A tela de caixa depende de tres RPCs que ja existem e estao testadas
// (030_caixa.sql, 30 assercoes). O que estes testes cobrem e o que a TELA recusa
// antes de chamar o banco, para o operador nao levar mensagem tecnica do Postgres.

describe('validarValorInicial', () => {
  it('gaveta vazia e zero, nao erro', () => {
    expect(validarValorInicial('')).toEqual({ ok: true, valor: 0 })
    expect(validarValorInicial('   ')).toEqual({ ok: true, valor: 0 })
  })

  it('le reais em centavos', () => {
    expect(validarValorInicial('100')).toEqual({ ok: true, valor: 10000 })
    expect(validarValorInicial('100,00')).toEqual({ ok: true, valor: 10000 })
    expect(validarValorInicial('100.00')).toEqual({ ok: true, valor: 10000 })
  })

  it('recusa texto e negativo', () => {
    expect(validarValorInicial('abc').ok).toBe(false)
    expect(validarValorInicial('-10').ok).toBe(false)
  })
})

describe('validarMovimento', () => {
  it('aceita sangria com motivo', () => {
    expect(validarMovimento('sangria', '50', 'deposito bancario')).toEqual({
      ok: true,
      valor: { tipo: 'sangria', centavos: 5000, motivo: 'deposito bancario' },
    })
  })

  it('aceita suprimento com motivo', () => {
    const r = validarMovimento('suprimento', '100,00', 'troco para o balcao')
    expect(r.ok).toBe(true)
  })

  it('recusa tipo que nao e sangria nem suprimento', () => {
    // 'venda' e 'cancelamento' existem na tabela, mas NAO se lancam a mao.
    expect(validarMovimento('venda', '50', 'x').ok).toBe(false)
    expect(validarMovimento('retirada', '50', 'x').ok).toBe(false)
  })

  it('recusa valor zero, negativo ou ilegivel', () => {
    expect(validarMovimento('sangria', '0', 'x').ok).toBe(false)
    expect(validarMovimento('sangria', '-5', 'x').ok).toBe(false)
    expect(validarMovimento('sangria', 'abc', 'x').ok).toBe(false)
    expect(validarMovimento('sangria', '', 'x').ok).toBe(false)
  })

  it('recusa motivo vazio ou so espacos', () => {
    expect(validarMovimento('sangria', '50', '').ok).toBe(false)
    expect(validarMovimento('sangria', '50', '   ').ok).toBe(false)
  })
})

describe('validarFechamento', () => {
  it('contado igual ao esperado fecha sem observacao', () => {
    expect(validarFechamento('350,00', '', 35000)).toEqual({
      ok: true,
      valor: { contado: 35000, observacao: null },
    })
  })

  it('diferenca SEM observacao e recusada, e a mensagem diz a diferenca', () => {
    const aMais = validarFechamento('360,00', '', 35000)
    expect(aMais.ok).toBe(false)
    if (!aMais.ok) {
      expect(aMais.mensagem).toContain('10,00')
      expect(aMais.mensagem).toContain('a mais')
    }
    const aMenos = validarFechamento('340,00', '', 35000)
    expect(aMenos.ok).toBe(false)
    if (!aMenos.ok) expect(aMenos.mensagem).toContain('a menos')
  })

  it('diferenca COM observacao e aceita', () => {
    const r = validarFechamento('340,00', 'faltou troco no balcao', 35000)
    expect(r).toEqual({ ok: true, valor: { contado: 34000, observacao: 'faltou troco no balcao' } })
  })

  it('dinheiro sobrando na gaveta tambem exige observacao', () => {
    // Diferenca positiva e tao suspeita quanto negativa: as duas precisam de
    // explicacao. Nao ha "diferenca boa".
    expect(validarFechamento('400,00', '', 35000).ok).toBe(false)
  })

  it('recusa valor contado ilegivel ou negativo', () => {
    expect(validarFechamento('abc', 'x', 35000).ok).toBe(false)
    expect(validarFechamento('-1', 'x', 35000).ok).toBe(false)
  })

  it('caixa que abriu com zero e fechou com zero passa', () => {
    expect(validarFechamento('0', '', 0)).toEqual({ ok: true, valor: { contado: 0, observacao: null } })
  })
})

describe('validarPapelFechamento', () => {
  it('dono fecha', () => {
    expect(validarPapelFechamento('dono')).toEqual({ ok: true, valor: true })
  })

  it('ATENDENTE TAMBEM FECHA — a regressao que travava o dia seguinte', () => {
    // A migration 018 (14/10/2026) liberou o fechamento para o atendente, e o
    // `130_fechamento_atendente.sql` prende o lado do banco. A action ficou para
    // tras exigindo so o dono: o atendente ABRIA o caixa (abrir_caixa nunca
    // checou papel), preenchia o fechamento e levava 'So o dono pode fechar o
    // caixa.'. A sessao ficava aberta e o dia seguinte travava em 'Ja existe um
    // caixa aberto.' (004). Este caso existe para a divergencia nao voltar.
    expect(validarPapelFechamento('atendente')).toEqual({ ok: true, valor: true })
  })

  it('papel que nao existe no banco e recusado', () => {
    // perfis.papel tem check in ('dono','atendente') desde a 001: qualquer outro
    // valor e dado corrompido, e a recusa aqui evita chamar a RPC para nada.
    expect(validarPapelFechamento('gerente').ok).toBe(false)
    expect(validarPapelFechamento('').ok).toBe(false)
  })
})
