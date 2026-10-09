// O que a tela `/agente` mostra depois do `POST /api/agente` — PURO: sem React,
// sem `fetch`, sem DOM. Existe separado do componente porque esta e a fronteira
// que mais importa da tela e a unica testavel sem navegador (o projeto nao tem
// jsdom nem testing-library, e o plano proibe instalar dependencia).
//
// CONTRATO (R6, ja implementado na Tarefa 3):
//   200 -> `{resposta: string}`   recusa (401/403/400/429/500/502) -> `{erro: string}`
// O TEXTO VEM DO SERVIDOR: o cliente nao reescreve nem traduz mensagem nenhuma.
//
// As duas mensagens escritas AQUI sao a ultima linha de defesa contra a tela em
// branco, e so aparecem quando o servidor nao produziu nem `resposta` nem `erro`
// (rede fora, corpo que nao e JSON, `resposta` vazia ou de outro tipo). Elas nao
// nomeiam view, prompt, chave, provedor nem codigo de erro: a tela nunca expoe
// detalhe interno (spec, "Limites, mensagens e falhas").

/** Falha antes de haver resposta do servidor: rede fora, aba offline, fetch que lancou. */
export const ERRO_REDE =
  'Não foi possível falar com o assistente agora. Verifique a conexão e tente novamente.'

/** Resposta do servidor fora do contrato: nada que possa ser mostrado ao usuario. */
export const ERRO_INESPERADO = 'O assistente respondeu de forma inesperada. Tente novamente.'

export type ResultadoTela = { tipo: 'resposta'; texto: string } | { tipo: 'erro'; texto: string }

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : ''
}

/**
 * Traduz a resposta HTTP do agente no que a tela mostra.
 *
 * Regras, na ordem:
 *   1. `ok` e `resposta` nao vazia -> mostra a resposta;
 *   2. `erro` nao vazio -> mostra a recusa do servidor (inclusive quando o corpo
 *      traz as duas coisas e a resposta HTTP nao e ok: resposta parcial de erro
 *      nao vai para a tela);
 *   3. qualquer outra coisa -> mensagem fixa, nunca tela em branco e nunca a
 *      saida crua do modelo.
 *
 * Texto que so tem espaco conta como vazio: mostrar uma caixa em branco seria
 * pior do que dizer que algo saiu do esperado.
 */
export function lerRespostaAgente(httpOk: boolean, bruto: unknown): ResultadoTela {
  const corpo = typeof bruto === 'object' && bruto !== null ? (bruto as Record<string, unknown>) : {}
  const resposta = texto(corpo.resposta)
  const erro = texto(corpo.erro)

  if (httpOk && resposta !== '') return { tipo: 'resposta', texto: resposta }
  if (erro !== '') return { tipo: 'erro', texto: erro }
  return { tipo: 'erro', texto: ERRO_INESPERADO }
}
