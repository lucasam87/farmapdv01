import { describe, expect, it } from 'vitest'
import { CONSULTAS_CLIENTE, respostaCliente, validarConsultaCliente } from './logica'

// ============================================================
// ESPECIALISTA de Clientes e crediario — a camada pura.
//
// Ele le `v_clientes_devedores`, que JA EXISTE (nao precisa de banco novo) e, ao
// contrario do de financeiro, **nao filtra periodo**: "quem me deve" e uma foto do
// agora. Por isso o contrato e so `{ "consulta": ... }`.
// ============================================================

describe('validarConsultaCliente', () => {
  it('aceita as duas consultas do dominio', () => {
    for (const consulta of CONSULTAS_CLIENTE) {
      expect(validarConsultaCliente({ consulta })).toBe(consulta)
    }
  })

  it('a lista e fechada e tem exatamente duas', () => {
    expect(CONSULTAS_CLIENTE).toHaveLength(2)
    expect([...CONSULTAS_CLIENTE].sort()).toEqual(['devedores', 'total_a_receber'])
  })

  it('aceita a string de conteudo do modelo', () => {
    expect(validarConsultaCliente('{"consulta": "devedores"}')).toBe('devedores')
  })

  it('NAO aceita periodo: este especialista nao filtra data', () => {
    // Chave a mais e recusa — e `de`/`ate` seria pedir um recorte que a view nao faz.
    expect(validarConsultaCliente({ consulta: 'devedores', de: null, ate: null })).toBeNull()
  })

  it('recusa o formato do COORDENADOR e o do especialista de financeiro', () => {
    expect(validarConsultaCliente({ assunto: 'clientes' })).toBeNull()
    expect(validarConsultaCliente({ consulta: 'devedores', limite: 10 })).toBeNull()
  })

  it('recusa consulta fora da lista', () => {
    expect(validarConsultaCliente({ consulta: 'faturamento' })).toBeNull()
    expect(validarConsultaCliente({ consulta: '' })).toBeNull()
  })

  it('recusa o que nao e objeto', () => {
    expect(validarConsultaCliente(null)).toBeNull()
    expect(validarConsultaCliente('devedores')).toBeNull()
    expect(validarConsultaCliente([])).toBeNull()
    expect(validarConsultaCliente({})).toBeNull()
    expect(validarConsultaCliente({ consulta: 1 })).toBeNull()
  })
})

describe('respostaCliente', () => {
  it('lista quem deve, do MAIOR saldo para o menor, e fecha com o total', () => {
    const texto = respostaCliente({
      consulta: 'devedores',
      clientes: [
        { nome: 'ANA', saldo: 1_000 },
        { nome: 'LEILA', saldo: 5_000 },
      ],
    })
    expect(texto).toBe(
      'Clientes com saldo em aberto\n' +
        '1. LEILA: R$ 50,00\n' +
        '2. ANA: R$ 10,00\n' +
        'Total a receber: R$ 60,00.',
    )
  })

  it('total_a_receber fala no singular com UM cliente', () => {
    const texto = respostaCliente({ consulta: 'total_a_receber', clientes: [{ nome: 'ANA', saldo: 5_000 }] })
    expect(texto).toBe('1 cliente com saldo em aberto, num total de R$ 50,00.')
  })

  it('total_a_receber fala no plural com mais de um', () => {
    const texto = respostaCliente({
      consulta: 'total_a_receber',
      clientes: [
        { nome: 'ANA', saldo: 5_000 },
        { nome: 'LEILA', saldo: 2_500 },
      ],
    })
    expect(texto).toBe('2 clientes com saldo em aberto, num total de R$ 75,00.')
  })

  it('ninguem devendo NAO vira "R$ 0,00 a receber"', () => {
    // Zero e um valor medido; ausencia de divida e outra coisa.
    const texto = respostaCliente({ consulta: 'total_a_receber', clientes: [] })
    expect(texto).toBe('Nenhum cliente com saldo em aberto.')
    expect(texto).not.toContain('0,00')
  })

  it('a lista vazia tambem diz a verdade, nas duas consultas', () => {
    expect(respostaCliente({ consulta: 'devedores', clientes: [] })).toBe(
      'Nenhum cliente com saldo em aberto.',
    )
  })

  it('a ordenacao nao depende da ordem que a view devolveu', () => {
    const texto = respostaCliente({
      consulta: 'devedores',
      clientes: [
        { nome: 'A', saldo: 100 },
        { nome: 'B', saldo: 9_999 },
        { nome: 'C', saldo: 500 },
      ],
    })
    expect(texto.indexOf('B:')).toBeLessThan(texto.indexOf('C:'))
    expect(texto.indexOf('C:')).toBeLessThan(texto.indexOf('A:'))
  })
})
