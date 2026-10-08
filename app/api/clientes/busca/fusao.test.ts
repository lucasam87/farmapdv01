import { describe, it, expect } from 'vitest'
import {
  LIMITE_DA_BUSCA,
  juntarClientes,
  type LinhaCliente,
  type LinhaDevedor,
} from './fusao'

// A juncao das duas origens da busca de cliente. Tres regras que erram CALADO se
// sairem erradas, e que o e2e nao alcanca (o cliente do cenario nao deve nada, e
// passa so pelo segundo ramo): devedor primeiro, ninguem repetido, corte unico de 8.

function devedor(id: string, nome: string, saldo: number | string): LinhaDevedor {
  return { cliente_id: id, nome, telefone: null, limite_credito: 10000, saldo }
}

function cliente(id: string, nome: string): LinhaCliente {
  return { id, nome, telefone: '11999998888', limite_credito: 0 }
}

describe('juntarClientes', () => {
  it('devedores vem primeiro, com o saldo da view normalizado', () => {
    const lista = juntarClientes([devedor('d1', 'JOSE DA DIVIDA', '3000')], [cliente('c1', 'ANA')])
    expect(lista.map((c) => c.id)).toEqual(['d1', 'c1'])
    expect(lista[0].saldo).toBe(3000)
    expect(lista[1].saldo).toBe(0)
  })

  it('o devedor que TAMBEM casa a busca por nome nao vira duas linhas', () => {
    // O caso real: a view e a tabela devolvem o mesmo cliente, e o segundo ramo
    // repete o id. Sem o dedupe, o balcao veria o mesmo devedor duas vezes — e com
    // um deles mostrando "deve R$ 0,00".
    const lista = juntarClientes(
      [devedor('mesmo', 'MARIA SILVA', '3000')],
      [cliente('mesmo', 'MARIA SILVA'), cliente('outro', 'MARIA SOUZA')],
    )
    expect(lista.map((c) => c.id)).toEqual(['mesmo', 'outro'])
    expect(lista[0].saldo).toBe(3000)
    expect(lista.filter((c) => c.id === 'mesmo')).toHaveLength(1)
  })

  it('id repetido dentro da propria view tambem entra uma vez so', () => {
    const lista = juntarClientes([devedor('d1', 'A', 100), devedor('d1', 'A', 200)], [])
    expect(lista).toHaveLength(1)
    expect(lista[0].saldo).toBe(100)
  })

  it('respeita o corte de 8 sobre a LISTA, e corta pelo fim', () => {
    const devedores = Array.from({ length: 8 }, (_, i) => devedor(`d${i}`, `DEVEDOR ${i}`, 100 + i))
    const demais = Array.from({ length: 5 }, (_, i) => cliente(`c${i}`, `CLIENTE ${i}`))
    const lista = juntarClientes(devedores, demais)
    expect(lista).toHaveLength(LIMITE_DA_BUSCA)
    // Os 8 devedores enchem a lista: nenhum "demais" entra, nem sobra buraco.
    expect(lista.every((c) => c.id.startsWith('d'))).toBe(true)
  })

  it('com devedores e demais, o corte tira do FIM da lista (demais), nao do devedor', () => {
    const devedores = Array.from({ length: 3 }, (_, i) => devedor(`d${i}`, `DEVEDOR ${i}`, 100))
    const demais = Array.from({ length: 7 }, (_, i) => cliente(`c${i}`, `CLIENTE ${i}`))
    const lista = juntarClientes(devedores, demais)
    expect(lista.map((c) => c.id)).toEqual(['d0', 'd1', 'd2', 'c0', 'c1', 'c2', 'c3', 'c4'])
  })

  it('so demais clientes: a lista sai inteira, sem saldo', () => {
    const lista = juntarClientes([], [cliente('c1', 'ANA'), cliente('c2', 'BRUNO')])
    expect(lista.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(lista.map((c) => c.saldo)).toEqual([0, 0])
  })

  it('so devedores: a lista sai inteira, com os saldos', () => {
    const lista = juntarClientes([devedor('d1', 'A', 500), devedor('d2', 'B', 250)], [])
    expect(lista.map((c) => c.saldo)).toEqual([500, 250])
  })

  it('as duas origens vazias devolvem lista vazia', () => {
    expect(juntarClientes([], [])).toEqual([])
  })

  it('leva o telefone e o limite das duas origens para a tela', () => {
    const lista = juntarClientes([devedor('d1', 'JOSE', 100)], [cliente('c1', 'ANA')])
    expect(lista[0]).toMatchObject({ nome: 'JOSE', telefone: null, limite_credito: 10000 })
    expect(lista[1]).toMatchObject({ nome: 'ANA', telefone: '11999998888', limite_credito: 0 })
  })

  it('o limite e parametro: 1 devolve so o primeiro devedor', () => {
    const lista = juntarClientes([devedor('d1', 'A', 1), devedor('d2', 'B', 2)], [cliente('c1', 'C')], 1)
    expect(lista.map((c) => c.id)).toEqual(['d1'])
  })
})
