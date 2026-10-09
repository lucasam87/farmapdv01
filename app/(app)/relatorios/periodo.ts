import { diaAnterior, diaSeguinte, validarDia } from '../vendas/dia'

export type Periodo = { de: string; ate: string }

export function formatarDataCivil(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split('-')
  return `${diaDoMes}/${mes}/${ano}`
}

export function atalhos(hoje: string): { rotulo: string; periodo: Periodo }[] {
  let inicioSeteDias = hoje
  for (let i = 0; i < 6; i += 1) {
    inicioSeteDias = diaAnterior(inicioSeteDias)
  }

  return [
    { rotulo: 'Hoje', periodo: { de: hoje, ate: hoje } },
    { rotulo: 'Ontem', periodo: { de: diaAnterior(hoje), ate: diaAnterior(hoje) } },
    { rotulo: '7 dias', periodo: { de: inicioSeteDias, ate: hoje } },
    { rotulo: 'Este mês', periodo: { de: `${hoje.slice(0, 7)}-01`, ate: hoje } },
  ]
}

export function validarPeriodo(
  de: string | undefined,
  ate: string | undefined,
  hoje: string,
): { periodo: Periodo; aviso: boolean } {
  if (de === undefined || ate === undefined) {
    return { periodo: { de: hoje, ate: hoje }, aviso: false }
  }
  if (de === '' || ate === '') {
    return { periodo: { de: hoje, ate: hoje }, aviso: true }
  }

  const inicio = validarDia(de, hoje)
  const fim = validarDia(ate, hoje)
  if (inicio.aviso || fim.aviso || inicio.dia > fim.dia) {
    return { periodo: { de: hoje, ate: hoje }, aviso: true }
  }

  return { periodo: { de: inicio.dia, ate: fim.dia }, aviso: false }
}

function diaEmUtc(data: string): number {
  const [ano, mes, dia] = data.split('-').map(Number)
  const dataUtc = new Date(Date.UTC(ano, mes - 1, dia))
  // Date.UTC trata os anos 0–99 como 1900–1999; restaura o ano literal.
  if (ano >= 0 && ano < 100) dataUtc.setUTCFullYear(ano)
  return dataUtc.getTime()
}

export function diasDoPeriodo(periodo: Periodo): number {
  return (diaEmUtc(diaSeguinte(periodo.ate)) - diaEmUtc(periodo.de)) / 86_400_000
}

export function ticketMedio(faturamento: number, vendas: number): number {
  return vendas === 0 ? 0 : Math.round(faturamento / vendas)
}
