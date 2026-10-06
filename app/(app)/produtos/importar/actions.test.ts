import { describe, it, expect } from 'vitest'
import { paraOLinhasJson } from './preparacao'
import { analisarTabela } from '@/lib/tabela'
import type { LinhaProduto } from '@/lib/tabela'

// O que este teste protege e o contrato entre a TELA e a RPC importar_produtos:
//   1. linha com erro nao pode chegar ao banco (tudo ou nada);
//   2. a chave `estoque_inicial` so viaja quando a planilha TROUXE a coluna —
//      chave ausente faz a RPC nao mexer no estoque de quem ja existe.

function linha(parcial: Partial<LinhaProduto> = {}): LinhaProduto {
  return {
    codigo_barras: '0012345',
    nome: 'DIPIRONA 500mg',
    categoria: null,
    unidade: 'un',
    preco_custo: 250,
    preco_venda: 450,
    estoque_atual: null,
    estoque_minimo: 0,
    erros: [],
    ...parcial,
  }
}

describe('paraOLinhasJson', () => {
  it('descarta a linha com erro', () => {
    const json = paraOLinhasJson([
      linha(),
      linha({ nome: '', erros: ['Informe o nome do produto.'] }),
    ])
    expect(json).toHaveLength(1)
    expect(json[0].nome).toBe('DIPIRONA 500mg')
  })

  it('nao inclui estoque_inicial quando a planilha nao trouxe a coluna', () => {
    const json = paraOLinhasJson([linha({ estoque_atual: null })])
    expect('estoque_inicial' in json[0]).toBe(false)
  })

  it('inclui estoque_inicial quando a planilha trouxe, inclusive zero', () => {
    const comZero = paraOLinhasJson([linha({ estoque_atual: 0 })])
    const comDez = paraOLinhasJson([linha({ estoque_atual: 10 })])
    expect(comZero[0].estoque_inicial).toBe(0)
    expect(comDez[0].estoque_inicial).toBe(10)
  })

  it('so as linhas validas de uma tabela real chegam ao JSON', () => {
    // A tabela tem uma linha boa e uma sem nome: o JSON tem que sair com UMA.
    const tabela = analisarTabela({
      colunas: ['nome', 'codigo', 'preco'],
      linhas: [
        ['DIPIRONA', '0012345', '4,50'],
        ['', '0099999', '9,99'],
      ],
    })
    const json = paraOLinhasJson(tabela.linhas)
    expect(tabela.invalidas).toBe(1)
    expect(json).toHaveLength(1)
    expect(json[0].codigo_barras).toBe('0012345')
  })
})
