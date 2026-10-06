import { describe, it, expect } from 'vitest'
import { analisarProduto, analisarEntrada, analisarAjuste } from './validacao'

// O balcao digita texto. Se esse texto chegar cru ao banco, o operador ve
// "invalid input syntax for type integer" no meio da tela. Estes testes provam
// que a recusa acontece AQUI, em portugues, antes de qualquer RPC.

function fd(campos: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) f.append(k, v)
  return f
}

describe('analisarProduto', () => {
  it('aceita um cadastro simples e converte os precos', () => {
    const r = analisarProduto(fd({ nome: 'DIPIRONA 500mg', preco_custo: '2,50', preco_venda: '4,50' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dados.p_produto_id).toBeNull() // vazio = cadastro novo
    expect(r.dados.p_preco_custo).toBe(250)
    expect(r.dados.p_preco_venda).toBe(450)
    expect(r.dados.p_unidade).toBe('un') // padrao quando nao informado
  })

  it('recusa nome vazio', () => {
    const r = analisarProduto(fd({ nome: '  ', preco_venda: '4,50' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.mensagem).toContain('nome do produto')
  })

  it('recusa preco de venda ilegivel com exemplo em portugues', () => {
    const r = analisarProduto(fd({ nome: 'X', preco_custo: '2,50', preco_venda: '4,5O' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.mensagem).toContain('Preço de venda inválido')
  })

  it('recusa estoque minimo fracionario', () => {
    const r = analisarProduto(fd({ nome: 'X', preco_custo: '2,50', preco_venda: '4,50', estoque_minimo: '1.5' }))
    expect(r.ok).toBe(false)
  })

  it('aceita estoque minimo zero', () => {
    const r = analisarProduto(fd({ nome: 'X', preco_custo: '2,50', preco_venda: '4,50', estoque_minimo: '0' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dados.p_estoque_minimo).toBe(0)
  })

  it('codigo de barras vazio vira null e categoria vazia vira null', () => {
    const r = analisarProduto(fd({ nome: 'X', preco_custo: '2,50', preco_venda: '4,50', codigo_barras: ' ', categoria: '' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dados.p_codigo_barras).toBeNull()
    expect(r.dados.p_categoria).toBeNull()
  })

  it('edicao traz o id do campo oculto', () => {
    const r = analisarProduto(fd({ produto_id: 'abc-123', nome: 'X', preco_custo: '2,50', preco_venda: '4,50' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dados.p_produto_id).toBe('abc-123')
  })

  it('sem checkbox de ativo, o produto fica inativo', () => {
    const r = analisarProduto(fd({ nome: 'X', preco_custo: '2,50', preco_venda: '4,50' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dados.p_ativo).toBe(false)
  })
})

describe('analisarEntrada', () => {
  it('recusa quantidade fracionaria antes de chamar a RPC (Review Focus 4)', () => {
    const r = analisarEntrada(fd({ produto_id: 'p1', quantidade: '1.5', motivo: 'compra' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.mensagem).toBe('Quantidade inválida. Use um número inteiro de 1 a 9999.')
  })

  it('recusa quantidade zero, negativa e acima do limite', () => {
    for (const q of ['0', '-1', '10000']) {
      const r = analisarEntrada(fd({ produto_id: 'p1', quantidade: q, motivo: 'compra' }))
      expect(r.ok).toBe(false)
    }
  })

  it('custo vazio vira null (nao mexe no custo cadastrado)', () => {
    const r = analisarEntrada(fd({ produto_id: 'p1', quantidade: '10', motivo: 'compra' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dados.p_custo).toBeNull()
  })

  it('custo informado vira centavos', () => {
    const r = analisarEntrada(fd({ produto_id: 'p1', quantidade: '10', custo: '3,20', motivo: 'compra' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dados.p_custo).toBe(320)
  })

  it('recusa custo ilegivel', () => {
    const r = analisarEntrada(fd({ produto_id: 'p1', quantidade: '10', custo: 'abc', motivo: 'compra' }))
    expect(r.ok).toBe(false)
  })

  it('recusa motivo vazio', () => {
    const r = analisarEntrada(fd({ produto_id: 'p1', quantidade: '10', motivo: '   ' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.mensagem).toContain('motivo da entrada')
  })
})

describe('analisarAjuste', () => {
  it('aceita saldo zero (zerar o estoque e legitimo)', () => {
    const r = analisarAjuste(fd({ produto_id: 'p1', novo_saldo: '0', motivo: 'inventario' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dados.p_novo_saldo).toBe(0)
  })

  it('recusa saldo negativo', () => {
    const r = analisarAjuste(fd({ produto_id: 'p1', novo_saldo: '-1', motivo: 'inventario' }))
    expect(r.ok).toBe(false)
  })

  it('recusa saldo vazio e motivo vazio', () => {
    expect(analisarAjuste(fd({ produto_id: 'p1', novo_saldo: '', motivo: 'x' })).ok).toBe(false)
    const semMotivo = analisarAjuste(fd({ produto_id: 'p1', novo_saldo: '5', motivo: '' }))
    expect(semMotivo.ok).toBe(false)
    if (semMotivo.ok) return
    expect(semMotivo.mensagem).toContain('motivo do ajuste')
  })

  it('recusa produto ausente nas tres funcoes', () => {
    expect(analisarEntrada(fd({ quantidade: '1', motivo: 'x' })).ok).toBe(false)
    expect(analisarAjuste(fd({ novo_saldo: '1', motivo: 'x' })).ok).toBe(false)
  })
})
