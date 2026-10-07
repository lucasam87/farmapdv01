import { describe, it, expect } from 'vitest'
import {
  somarItens,
  somarPagamentos,
  calcularTotal,
  calcularFalta,
  calcularTroco,
  lerDesconto,
  adicionarItem,
  type ItemCarrinho,
  type Pagamento,
} from './pagamento'

// Estas contas sao de APOIO na tela: quem decide de verdade e o banco. Mesmo
// assim elas precisam estar certas, senao o atendente ve um numero e o sistema
// grava outro — que e a pior forma de errar dinheiro.

function item(preco: number, quantidade = 1, id = 'p1'): ItemCarrinho {
  return { produto_id: id, nome: `PRODUTO ${id}`, preco_unitario: preco, quantidade }
}

function pago(forma: Pagamento['forma'], valor: number): Pagamento {
  return { forma, valor }
}

describe('somarItens', () => {
  it('soma preco x quantidade', () => {
    expect(somarItens([item(450, 2), item(1000, 1, 'p2')])).toBe(1900)
  })
  it('carrinho vazio soma zero', () => {
    expect(somarItens([])).toBe(0)
  })
})

describe('calcularTotal', () => {
  it('desconta do subtotal', () => {
    expect(calcularTotal([item(1000)], 300)).toBe(700)
  })
  it('nao fica negativo se o desconto passar do subtotal', () => {
    expect(calcularTotal([item(1000)], 5000)).toBe(0)
  })
})

describe('calcularFalta', () => {
  it('mostra o que falta receber', () => {
    expect(calcularFalta(5000, [pago('pix', 3000)])).toBe(2000)
  })
  it('nao fica negativa quando ja passou do total', () => {
    expect(calcularFalta(5000, [pago('pix', 6000)])).toBe(0)
  })
})

describe('calcularTroco', () => {
  it('dinheiro a mais vira troco', () => {
    // Venda de 9,00 paga com 20,00 em dinheiro: troco 11,00.
    expect(calcularTroco(900, [pago('dinheiro', 2000)])).toBe(1100)
  })
  it('cartao cobrindo parte e dinheiro cobrindo o resto', () => {
    // Total 50,00: PIX 30,00 + dinheiro 25,00 -> troco 5,00.
    expect(calcularTroco(5000, [pago('pix', 3000), pago('dinheiro', 2500)])).toBe(500)
  })
  it('cartao e PIX NAO geram troco', () => {
    expect(calcularTroco(5000, [pago('pix', 6000)])).toBe(0)
    expect(calcularTroco(5000, [pago('credito', 6000)])).toBe(0)
  })
  it('sem pagamento nao ha troco', () => {
    expect(calcularTroco(1000, [])).toBe(0)
  })
  it('venda no crediario nao gera troco', () => {
    expect(calcularTroco(4500, [pago('crediario', 4500)])).toBe(0)
  })
})

describe('lerDesconto', () => {
  it('le desconto em reais', () => {
    expect(lerDesconto('5', 10000)).toBe(500)
    expect(lerDesconto('5,50', 10000)).toBe(550)
  })
  it('le desconto em porcento', () => {
    expect(lerDesconto('10%', 10000)).toBe(1000)
    expect(lerDesconto('2,5%', 10000)).toBe(250)
  })
  it('vazio e zero', () => {
    expect(lerDesconto('', 10000)).toBe(0)
  })
  it('recusa texto e porcentagem acima de 100', () => {
    expect(lerDesconto('abc', 10000)).toBeNull()
    expect(lerDesconto('150%', 10000)).toBeNull()
    expect(lerDesconto('-5', 10000)).toBeNull()
  })
  // O PDV tinha um leitor de dinheiro PROPRIO, que tratava o ponto sempre como
  // milhar: "20.00" virava R$ 2.000,00 no balcao e R$ 20,00 na importacao. O
  // contrato do projeto e UM leitor so, o parsearCentavos.
  it('le o ponto com 1 ou 2 digitos como decimal, igual ao resto do sistema', () => {
    expect(lerDesconto('20.00', 100000)).toBe(2000)
    expect(lerDesconto('5.50', 100000)).toBe(550)
  })
  it('ponto com tres digitos continua sendo milhar', () => {
    expect(lerDesconto('1.234', 1000000)).toBe(123400)
  })
  it('aceita R$ e espaco, como o leitor oficial de dinheiro', () => {
    expect(lerDesconto('R$ 5', 10000)).toBe(500)
  })
})

describe('adicionarItem', () => {
  it('adiciona produto novo', () => {
    expect(adicionarItem([], item(450))).toHaveLength(1)
  })
  it('o mesmo produto soma na quantidade em vez de virar duas linhas', () => {
    const comUm = adicionarItem([], item(450, 1))
    const comDois = adicionarItem(comUm, item(450, 2))
    expect(comDois).toHaveLength(1)
    expect(comDois[0].quantidade).toBe(3)
  })
})

describe('somarPagamentos', () => {
  it('soma as formas', () => {
    expect(somarPagamentos([pago('pix', 1000), pago('dinheiro', 500)])).toBe(1500)
  })
})
