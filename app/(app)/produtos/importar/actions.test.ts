import { describe, it, expect } from 'vitest'
import { paraOLinhasJson } from './preparacao'
import { analisarTabela } from '@/lib/tabela'
import type { LinhaProduto } from '@/lib/tabela'

// O que este teste protege e o contrato entre a TELA e a RPC importar_produtos:
//   1. linha com erro nao pode chegar ao banco (tudo ou nada);
//   2. a chave `estoque_inicial` so viaja quando a planilha TROUXE a coluna —
//      chave ausente faz a RPC nao mexer no estoque de quem ja existe.
//   3. o MESMO vale para os precos e o estoque minimo: ausente = nao mexe. Antes
//      eles viajavam sempre (0 quando a coluna nao existia) e a reimportacao de
//      uma planilha sem preco ZERAVA o preco de venda do catalogo (migration 009).

const TUDO = { preco_custo: true, preco_venda: true, estoque_minimo: true }

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
    const json = paraOLinhasJson(
      [linha(), linha({ nome: '', erros: ['Informe o nome do produto.'] })],
      TUDO,
    )
    expect(json).toHaveLength(1)
    expect(json[0].nome).toBe('DIPIRONA 500mg')
  })

  it('nao inclui estoque_inicial quando a planilha nao trouxe a coluna', () => {
    const json = paraOLinhasJson([linha({ estoque_atual: null })], TUDO)
    expect('estoque_inicial' in json[0]).toBe(false)
  })

  it('inclui estoque_inicial quando a planilha trouxe, inclusive zero', () => {
    const comZero = paraOLinhasJson([linha({ estoque_atual: 0 })], TUDO)
    const comDez = paraOLinhasJson([linha({ estoque_atual: 10 })], TUDO)
    expect(comZero[0].estoque_inicial).toBe(0)
    expect(comDez[0].estoque_inicial).toBe(10)
  })

  it('nao inclui preco nenhum quando a planilha nao trouxe as colunas', () => {
    const json = paraOLinhasJson([linha()], {
      preco_custo: false,
      preco_venda: false,
      estoque_minimo: false,
    })
    expect('preco_venda' in json[0]).toBe(false)
    expect('preco_custo' in json[0]).toBe(false)
    expect('estoque_minimo' in json[0]).toBe(false)
  })

  it('inclui o preco quando a planilha trouxe a coluna, inclusive zero', () => {
    const json = paraOLinhasJson([linha({ preco_venda: 0 })], { ...TUDO, preco_custo: false })
    expect(json[0].preco_venda).toBe(0)
    expect('preco_custo' in json[0]).toBe(false)
  })

  it('uma tabela REAL sem coluna de preco nao manda preco nenhum para a RPC', () => {
    // O caminho completo: planilha -> analisarTabela -> JSON. E a prova de que
    // reimportar uma planilha de contagem nao zera o preco do catalogo.
    const tabela = analisarTabela({
      colunas: ['nome', 'codigo'],
      linhas: [['DIPIRONA', '0012345']],
    })
    const json = paraOLinhasJson(tabela.linhas, tabela.colunasPresentes)
    expect('preco_venda' in json[0]).toBe(false)
    expect('preco_custo' in json[0]).toBe(false)
    expect(tabela.colunasPresentes.preco_venda).toBe(false)
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
    const json = paraOLinhasJson(tabela.linhas, tabela.colunasPresentes)
    expect(tabela.invalidas).toBe(1)
    expect(json).toHaveLength(1)
    expect(json[0].codigo_barras).toBe('0012345')
  })
})
