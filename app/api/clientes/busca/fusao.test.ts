import { describe, it, expect } from 'vitest'
import {
  LIMITE_DA_BUSCA,
  juntarClientes,
  type LinhaCliente,
  type LinhaDevedor,
  type LinhaSaldo,
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
    const lista = juntarClientes(
      [devedor('d1', 'A', 1), devedor('d2', 'B', 2)],
      [cliente('c1', 'C')],
      [],
      1,
    )
    expect(lista.map((c) => c.id)).toEqual(['d1'])
  })
})

// O SALDO DE QUEM VEM DO SEGUNDO RAMO (Important 1 da revisao final do branch).
//
// A view nao expoe `cpf`, entao o cliente que o operador acha digitando o CPF chega
// pelo segundo ramo — e o saldo dele nao esta entre as linhas que o primeiro ramo
// devolveu. O PDV imprime "deve R$ <saldo> de R$ <limite>": gravar 0 aqui faz o
// balcao LER uma divida menor do que a real. Estes casos provam a fusao; a terceira
// consulta da rota (a que busca esses saldos) nao tem teste — o e2e do cenario nao
// tem cliente devedor que case so por CPF.
describe('juntarClientes com os saldos do segundo ramo', () => {
  function saldo(id: string, valor: number | string): LinhaSaldo {
    return { cliente_id: id, saldo: valor }
  }

  it('quem casa SO por CPF sai com o saldo da view, e nao com zero', () => {
    const lista = juntarClientes(
      [],
      [cliente('c1', 'JOSE DA DIVIDA'), cliente('c2', 'ANA')],
      [saldo('c1', '3000')],
    )
    // O devedor do segundo ramo com o valor certo, normalizado para numero (a view
    // devolve bigint, que pode chegar como texto); quem nao deve continua em zero.
    expect(lista.map((c) => c.saldo)).toEqual([3000, 0])
    expect(lista.every((c) => typeof c.saldo === 'number')).toBe(true)
  })

  it('o saldo do DEVEDOR ja vindo da view vence o do terceiro argumento', () => {
    // O id que aparece nas duas origens: o primeiro ramo ja trouxe o saldo certo e a
    // linha dele e a que entra na lista (dedupe pela primeira ocorrencia).
    const lista = juntarClientes([devedor('mesmo', 'MARIA', 500)], [], [saldo('mesmo', '999')])
    expect(lista).toHaveLength(1)
    expect(lista[0].saldo).toBe(500)
  })

  it('saldo zero da view e saldo ausente dao o mesmo resultado: zero', () => {
    const lista = juntarClientes([], [cliente('c1', 'ANA'), cliente('c2', 'BRUNO')], [saldo('c1', 0)])
    expect(lista.map((c) => c.saldo)).toEqual([0, 0])
  })

  it('o corte de 8 continua valendo com os saldos no meio', () => {
    const demais = Array.from({ length: 10 }, (_, i) => cliente(`c${i}`, `CLIENTE ${i}`))
    const saldos = demais.map((c) => saldo(c.id, 100))
    const lista = juntarClientes([], demais, saldos)
    expect(lista).toHaveLength(LIMITE_DA_BUSCA)
    // O corte tira do FIM: os 8 primeiros, todos com o saldo real.
    expect(lista.map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'])
    expect(lista.every((c) => c.saldo === 100)).toBe(true)
  })
})
