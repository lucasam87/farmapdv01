// Contas de data do historico de vendas — PURO: sem Supabase, sem React.
//
// A view `v_vendas_historico` ja entrega `dia` no fuso de Sao Paulo e
// `criado_em`/`cancelado_em` como `timestamp` SEM fuso, ja convertidos. Por isso
// aqui NAO se usa `Date` para formatar hora: o texto nao carrega fuso e o `Intl`
// aplicaria o fuso do processo, mostrando a hora errada em qualquer maquina que
// nao esteja em Sao Paulo (diferente de `lib/format.ts`, que formata ISO com `Z`).

/**
 * Uma linha da view `v_vendas_historico`. Os campos que a tela nao usa ficam
 * aqui mesmo assim: e o formato que a Task 3 recebe do banco.
 */
export type VendaHistorico = {
  venda_id: string
  numero: number
  dia: string
  criado_em: string
  cliente_id: string | null
  cliente_nome: string | null
  subtotal: number
  desconto: number
  total: number
  troco: number
  itens: string | null
  formas: string | null
  status: string
  cancelado_em: string | null
  cancelado_por_nome: string | null
  motivo_cancelamento: string | null
}

const DIA_VALIDO = /^\d{4}-\d{2}-\d{2}$/

/**
 * Le o dia que veio no endereco. Texto ausente ou vazio nao e erro: e a tela
 * abrindo no dia de hoje. Texto torto (formato errado ou data que nao existe,
 * como 31 de fevereiro) tambem cai em hoje, mas COM aviso — a tela mostra que o
 * endereco foi ignorado em vez de mentir que aquele dia tem vendas.
 */
export function validarDia(texto: string | undefined, hoje: string): { dia: string; aviso: boolean } {
  if (texto === undefined || texto === '') return { dia: hoje, aviso: false }
  if (!DIA_VALIDO.test(texto)) return { dia: hoje, aviso: true }
  // UTC de proposito: comparar em horario local faria a data existir ou nao
  // dependendo do fuso da maquina.
  const d = new Date(`${texto}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== texto) {
    return { dia: hoje, aviso: true }
  }
  return { dia: texto, aviso: false }
}

function andarUmDia(dia: string, passo: 1 | -1): string {
  const d = new Date(`${dia}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + passo)
  return d.toISOString().slice(0, 10)
}

/** "2026-03-01" -> "2026-02-28" (respeita mes, ano e ano bissexto). */
export function diaAnterior(dia: string): string {
  return andarUmDia(dia, -1)
}

/** "2026-12-31" -> "2027-01-01". */
export function diaSeguinte(dia: string): string {
  return andarUmDia(dia, 1)
}

/**
 * Como a tela chama o dia. Compara com `hoje` (que ja vem em Sao Paulo) em vez
 * de olhar o relogio da maquina: o "Hoje" da tela tem de ser o mesmo de quem
 * esta no balcao.
 */
export function rotuloDoDia(dia: string, hoje: string): string {
  if (dia === hoje) return 'Hoje'
  if (dia === diaAnterior(hoje)) return 'Ontem'
  const [ano, mes, d] = dia.split('-')
  return `${d}/${mes}/${ano}`
}

// "2026-01-15T22:00:00", "2026-01-15 22:00:00" — o PostgREST devolve as duas
// formas; os segundos e as fracoes sao descartados.
const SEM_FUSO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/

/** "2026-01-15 22:00:00" -> "22:00". Texto fora do padrao volta como veio. */
export function horaDe(semFuso: string): string {
  const m = SEM_FUSO.exec(semFuso)
  if (m === null) return semFuso
  return `${m[4]}:${m[5]}`
}

/** "2026-01-15T22:00:00" -> "15/01/2026 22:00". */
export function dataHoraDe(semFuso: string): string {
  const m = SEM_FUSO.exec(semFuso)
  if (m === null) return semFuso
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`
}

/**
 * A linha "Canceladas: N" do topo da tela. A venda cancelada continua na lista
 * (com o valor que ela valia), mas nao e faturamento — este resumo existe para
 * o dono ver de relance quanto do dia foi desfeito.
 */
export function resumirCanceladas(vendas: { status: string; total: number }[]): {
  quantidade: number
  total: number
} {
  let quantidade = 0
  let total = 0
  for (const venda of vendas) {
    if (venda.status === 'cancelada') {
      quantidade += 1
      total += venda.total
    }
  }
  return { quantidade, total }
}
