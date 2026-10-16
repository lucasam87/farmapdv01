// Validacao da tela de caixa.
//
// Fica fora do arquivo 'use server' de proposito (num arquivo de Server Actions
// todo export precisa ser async) e e PURA, entao da para testar sem renderizar
// nada — mesma escolha da validacao de produto e da importacao.
//
// O que ela protege, e que o banco tambem recusa (mas com mensagem tecnica):
//   - valor inicial negativo;
//   - movimento com valor zero ou negativo, ou sem motivo;
//   - FECHAMENTO COM DIFERENCA E SEM OBSERVACAO. A spec 8.3 diz que diferenca
//     diferente de zero nao bloqueia o fechamento, mas EXIGE observacao. O banco
//     recusa; aqui a mensagem diz a diferenca e para que lado ela foi.
//   - FECHAMENTO POR QUEM NAO E DONO NEM ATENDENTE (migration 018).

import { parsearCentavos } from '@/lib/dinheiro'
import { formatarMoeda } from '@/lib/format'

export type Resultado<T> = { ok: true; valor: T } | { ok: false; mensagem: string }

export type TipoMovimento = 'sangria' | 'suprimento'

/** Abrir caixa aceita vazio (gaveta vazia) e recusa negativo. */
export function validarValorInicial(texto: string): Resultado<number> {
  const limpo = texto.trim()
  if (limpo === '') return { ok: true, valor: 0 }

  const centavos = parsearCentavos(limpo)
  if (centavos === null) {
    return { ok: false, mensagem: 'Valor inicial inválido. Digite em reais, como 100,00.' }
  }
  if (centavos < 0) {
    return { ok: false, mensagem: 'O valor inicial não pode ser negativo.' }
  }
  return { ok: true, valor: centavos }
}

/** Sangria e suprimento: valor maior que zero e motivo obrigatorio. */
export function validarMovimento(
  tipo: string,
  valorTexto: string,
  motivo: string,
): Resultado<{ tipo: TipoMovimento; centavos: number; motivo: string }> {
  if (tipo !== 'sangria' && tipo !== 'suprimento') {
    return { ok: false, mensagem: 'Movimento de caixa inválido.' }
  }

  const centavos = parsearCentavos(valorTexto.trim())
  if (centavos === null) {
    return { ok: false, mensagem: 'Valor do movimento inválido. Digite em reais, como 50,00.' }
  }
  if (centavos <= 0) {
    return { ok: false, mensagem: 'O valor do movimento precisa ser maior que zero.' }
  }

  const limpo = motivo.trim()
  if (limpo === '') {
    return { ok: false, mensagem: 'Informe o motivo do movimento.' }
  }

  return { ok: true, valor: { tipo, centavos, motivo: limpo } }
}

/**
 * Fechamento. `esperado` vem da view `v_caixa_atual` (formula da spec 8.3).
 * Diferenca diferente de zero exige observacao — a spec nao bloqueia o
 * fechamento por diferenca, bloqueia por falta de explicacao.
 */
export function validarFechamento(
  valorContadoTexto: string,
  observacao: string,
  esperado: number,
): Resultado<{ contado: number; observacao: string | null }> {
  const centavos = parsearCentavos(valorContadoTexto.trim())
  if (centavos === null) {
    return { ok: false, mensagem: 'Valor contado inválido. Digite quanto tem na gaveta, como 350,00.' }
  }
  if (centavos < 0) {
    return { ok: false, mensagem: 'O valor contado não pode ser negativo.' }
  }

  const limpo = observacao.trim()
  if (centavos !== esperado && limpo === '') {
    const diferenca = centavos - esperado
    const lado = diferenca > 0 ? 'a mais' : 'a menos'
    return {
      ok: false,
      mensagem: `A diferença de ${formatarMoeda(Math.abs(diferenca))} ${lado} precisa de observação.`,
    }
  }

  return { ok: true, valor: { contado: centavos, observacao: limpo === '' ? null : limpo } }
}

/**
 * Quem pode fechar o caixa. Espelha a checagem da RPC `fechar_caixa`, que a
 * migration 018 (14/10/2026) mudou para aceitar dono E atendente.
 *
 * Esta regra existe escrita duas vezes de proposito — o banco recusa e a tela
 * explica antes, como todas as outras deste arquivo. Mas ela JA DIVERGIU UMA VEZ:
 * a action exigia SO o dono, o atendente abria o caixa (abrir_caixa nunca checou
 * papel) e nao conseguia fechar. Com o dono ausente a sessao ficava aberta e o dia
 * seguinte travava em 'Ja existe um caixa aberto.'. Se a RPC mudar de novo, este
 * teste tem de mudar junto: `tests/sql/casos/130_fechamento_atendente.sql` prende
 * o lado do banco.
 */
export function validarPapelFechamento(papel: string): Resultado<true> {
  if (papel === 'dono' || papel === 'atendente') return { ok: true, valor: true }
  return { ok: false, mensagem: 'Só o dono ou o atendente podem fechar o caixa.' }
}
