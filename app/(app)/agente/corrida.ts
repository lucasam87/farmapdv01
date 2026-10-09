// Quem pode escrever na tela depois de um `POST /api/agente` — PURO: sem React,
// sem `fetch`, sem DOM. Existe para o guarda da corrida ter teste sem navegador
// (o projeto nao tem jsdom).
//
// O DEFEITO QUE ESTE MODULO FECHA (Important 1 do round 1 da Tarefa 4): o campo e
// os exemplos continuam habilitados durante o carregamento — so o botao
// desabilita. Entao o usuario podia enviar "A", digitar "B" (ou clicar num
// exemplo) enquanto o POST estava em voo, e a resposta de "A" chegava DEPOIS e era
// renderizada embaixo de um campo que ja dizia "B": resposta certa para a pergunta
// errada. Limpar o estado no `onChange` (`setResposta(null)`) NAO resolvia, porque
// a resposta antiga continuava em voo e escrevia mesmo assim.
//
// A resposta de um envio so pode escrever na tela quando as DUAS coisas valem:
//   1. ele e o envio mais recente (id) — nenhum envio novo tomou o lugar dele;
//   2. a pergunta que esta no campo AGORA e exatamente a que ele enviou.
// A (1) mantem a ordem entre dois envios que se cruzem; a (2) e a que fecha o caso
// relatado. Juntas, o invariante da tela passa a ser verdade: a resposta visivel e
// sempre a resposta da pergunta que esta no campo.
//
// O que este modulo NAO faz: cancelar o POST (`AbortController`). Abortar nao
// cancela a classificacao ja paga no servidor — gastaria a reserva do mes sem
// mostrar nada ao atendente. A resposta que chega atrasada e simplesmente
// descartada, e o pedido segue o fluxo normal de reconciliacao do orcamento.

export type Envio = { id: number; pergunta: string }

/** O proximo envio: numero seguinte e o texto exato que foi mandado ao servidor. */
export function proximoEnvio(anterior: Envio | null, pergunta: string): Envio {
  return { id: (anterior?.id ?? 0) + 1, pergunta }
}

/**
 * A resposta de `envio` pode ser mostrada agora?
 *
 * `atual` e o envio mais recente da tela e `perguntaNaTela` e o texto do campo
 * NESTE instante — nao o do envio. Texto diferente (digitado ou vindo de um
 * exemplo) invalida a resposta, mesmo que ela seja a do envio atual.
 */
export function respostaAindaVale(
  envio: Envio,
  atual: Envio | null,
  perguntaNaTela: string,
): boolean {
  if (atual === null) return false
  return atual.id === envio.id && envio.pergunta === perguntaNaTela
}
