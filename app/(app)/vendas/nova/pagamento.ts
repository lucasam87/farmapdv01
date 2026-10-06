// Contas do pagamento do PDV.
//
// Ficam separadas do componente de tela de proposito: sao as unicas contas que o
// navegador faz, sao puras e dao para testar sem renderizar nada.
//
// ATENCAO ao contrato do projeto (spec 4): estas contas sao de APOIO, para o
// atendente ver quanto falta antes de fechar. Quem decide total, troco, desconto
// e limite e o BANCO, dentro de registrar_venda. O que o PDV envia e so intencao:
// produto_id, quantidade, forma e valor.

export type FormaPagamento = 'dinheiro' | 'pix' | 'debito' | 'credito' | 'crediario'

export type ItemCarrinho = {
  produto_id: string
  nome: string
  preco_unitario: number
  quantidade: number
}

export type Pagamento = { forma: FormaPagamento; valor: number }

export const FORMAS: { forma: FormaPagamento; rotulo: string; tecla: string }[] = [
  { forma: 'dinheiro', rotulo: 'Dinheiro', tecla: 'F6' },
  { forma: 'pix', rotulo: 'PIX', tecla: 'F7' },
  { forma: 'debito', rotulo: 'Débito', tecla: 'F8' },
  { forma: 'credito', rotulo: 'Crédito', tecla: 'F9' },
  { forma: 'crediario', rotulo: 'Crediário', tecla: 'F10' },
]

export function somarItens(itens: ItemCarrinho[]): number {
  return itens.reduce((soma, i) => soma + i.preco_unitario * i.quantidade, 0)
}

export function somarPagamentos(pagamentos: Pagamento[]): number {
  return pagamentos.reduce((soma, p) => soma + p.valor, 0)
}

/** Total = subtotal - desconto, nunca abaixo de zero. */
export function calcularTotal(itens: ItemCarrinho[], desconto: number): number {
  return Math.max(0, somarItens(itens) - desconto)
}

/** Quanto ainda falta receber para fechar a venda. */
export function calcularFalta(total: number, pagamentos: Pagamento[]): number {
  return Math.max(0, total - somarPagamentos(pagamentos))
}

/**
 * Troco: so o que foi entregue em DINHEIRO a mais vira troco (spec 8.1 passo 10).
 * Cartao e PIX acima do total nao viram credito — sao recusados pelo banco.
 */
export function calcularTroco(total: number, pagamentos: Pagamento[]): number {
  const dinheiro = pagamentos.filter((p) => p.forma === 'dinheiro').reduce((s, p) => s + p.valor, 0)
  const naoDinheiro = somarPagamentos(pagamentos) - dinheiro
  return Math.max(0, dinheiro - Math.max(0, total - naoDinheiro))
}

/**
 * O desconto pode ser digitado em reais ("5") ou em porcento ("5%").
 * Devolve centavos; `null` quando o texto nao da para ler.
 */
export function lerDesconto(texto: string, subtotal: number): number | null {
  const limpo = texto.trim()
  if (limpo === '') return 0

  if (limpo.endsWith('%')) {
    const numero = Number(limpo.slice(0, -1).replace(',', '.'))
    if (!Number.isFinite(numero) || numero < 0) return null
    if (numero > 100) return null
    return Math.round((subtotal * numero) / 100)
  }

  // Sem % e valor em reais: reaproveita a mesma leitura de dinheiro do sistema.
  const emCentavos = Number(limpo.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(emCentavos) || emCentavos < 0) return null
  return Math.round(emCentavos * 100)
}

/** Adiciona ao carrinho ou soma na quantidade, se o produto ja estiver la. */
export function adicionarItem(itens: ItemCarrinho[], novo: ItemCarrinho): ItemCarrinho[] {
  const existente = itens.find((i) => i.produto_id === novo.produto_id)
  if (!existente) return [...itens, novo]
  return itens.map((i) =>
    i.produto_id === novo.produto_id ? { ...i, quantidade: i.quantidade + novo.quantidade } : i,
  )
}
