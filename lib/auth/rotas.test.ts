import { describe, it, expect } from 'vitest'
import { rotaPublica } from './rotas'

describe('rotaPublica', () => {
  it('libera o login', () => { expect(rotaPublica('/login')).toBe(true) })
  it('libera as rotas de auth', () => { expect(rotaPublica('/auth/callback')).toBe(true) })
  it('protege a raiz', () => { expect(rotaPublica('/')).toBe(false) })
  it('protege as telas do app', () => {
    for (const r of ['/vendas', '/vendas/nova', '/produtos', '/estoque',
                     '/clientes', '/crediario', '/caixa', '/relatorios', '/agente']) {
      expect(rotaPublica(r)).toBe(false)
    }
  })
  it('nao confunde prefixo parecido com rota publica', () => {
    expect(rotaPublica('/logins')).toBe(false)
    expect(rotaPublica('/logindefake')).toBe(false)
  })
})
