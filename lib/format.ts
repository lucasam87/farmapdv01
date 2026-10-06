// Formatação de dinheiro e data para a interface (padrão brasileiro).
//
// Contrato do projeto: dinheiro circula e é armazenado em CENTAVOS INTEIROS.
// A conversão para reais acontece só aqui, na borda de exibição.

const MOEDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

// O Intl separa "R$" do número com espaço não-quebrável (U+00A0).
// Normalizamos para espaço comum: o texto é comparado em testes,
// concatenado em mensagens de WhatsApp e exportado em CSV.
function espacoComum(texto: string): string {
  return texto.replace(/\u00A0/g, ' ')
}

const DATA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** 123456 -> "R$ 1.234,56" */
export function formatarMoeda(centavos: number): string {
  return espacoComum(MOEDA.format(centavos / 100))
}

/**
 * "2026-10-06T01:30:00Z" -> "05/10/2026"
 * O fuso é explícito: uma venda às 22h em São Paulo pertence ao dia de São
 * Paulo, não ao dia UTC (que já seria o seguinte).
 */
export function formatarData(iso: string): string {
  return DATA.format(new Date(iso))
}

/** "2026-10-06T01:30:00Z" -> "05/10/2026 22:30" */
export function formatarDataHora(iso: string): string {
  // O Intl junta data e hora com ", "; aqui o padrão é um espaço só.
  return espacoComum(DATA_HORA.format(new Date(iso))).replace(', ', ' ')
}
