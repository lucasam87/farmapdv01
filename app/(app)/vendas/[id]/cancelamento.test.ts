import { describe, it, expect } from 'vitest'
import { validarMotivo } from './cancelamento'

// O motivo do cancelamento e o UNICO campo que a tela valida antes de chamar a
// RPC: o banco cuida de papel, caixa fechado e venda ja cancelada (matriz da spec
// 8.2), mas nao sabe distinguir "esqueci de escrever" de "escrevi". Nada aqui
// toca banco.

describe('validarMotivo', () => {
  it('motivo vazio pede para escrever', () => {
    expect(validarMotivo('')).toEqual({ ok: false, mensagem: 'Escreva o motivo do cancelamento.' })
    expect(validarMotivo('   ')).toEqual({ ok: false, mensagem: 'Escreva o motivo do cancelamento.' })
  })

  it('motivo curto demais nao passa: a RPC grava o texto no historico', () => {
    expect(validarMotivo('ab')).toEqual({
      ok: false,
      mensagem: 'Motivo muito curto: escreva pelo menos 3 letras.',
    })
  })

  it('devolve o motivo sem espacos nas pontas — e ele que vai para o banco', () => {
    expect(validarMotivo('cliente desistiu')).toEqual({ ok: true, motivo: 'cliente desistiu' })
    expect(validarMotivo('  cliente desistiu  ')).toEqual({ ok: true, motivo: 'cliente desistiu' })
  })

  it('motivo longo demais nao passa', () => {
    expect(validarMotivo('a'.repeat(201))).toEqual({
      ok: false,
      mensagem: 'Motivo muito longo: no máximo 200 letras.',
    })
  })
})
