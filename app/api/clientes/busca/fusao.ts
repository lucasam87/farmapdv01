// A juncao dos dois resultados da busca de cliente do PDV, FORA da rota.
//
// Por que existe: a busca consulta duas origens — `v_clientes_devedores` (que ja
// traz o saldo, e so quem deve) e a tabela `clientes` (que traz o CPF, e so quem
// nao aparece na view). Juntar isso tem tres regras que erram calado: DEVEDOR
// PRIMEIRO, ninguem repetido (a busca por nome casa os dois lados) e corte unico de
// 8 SOBRE A LISTA. Dentro do arquivo de rota isso nao tinha como ser testado — e o
// e2e nao discrimina: o cliente do cenario nao deve nada, entao ele so passa pelo
// segundo ramo. Aqui e uma funcao PURA (sem Supabase, sem React, sem I/O, mesma
// escolha de `app/(app)/clientes/validacao.ts`), com teste de unidade.
//
// O TERCEIRO ARGUMENTO (saldos) entrou na revisao final do branch (Important 1): a
// view nao expoe `cpf`, entao quem casa SO por CPF vem do segundo ramo — e o saldo
// dele NAO esta entre as linhas que o primeiro ramo devolveu. Sem esses saldos, o
// segundo ramo gravaria 0 e o PDV diria "deve R$ 0,00" para quem deve.

/** Teto da lista no balcao — o mesmo numero nas duas consultas da rota. */
export const LIMITE_DA_BUSCA = 8

/** O que a rota devolve e o PDV consome. `saldo` em CENTAVOS. */
export type ClienteDaBusca = {
  id: string
  nome: string
  telefone: string | null
  limite_credito: number
  saldo: number
}

/** Linha crua de `v_clientes_devedores` (so quem deve, com o saldo). */
export type LinhaDevedor = {
  cliente_id: string
  nome: string
  telefone: string | null
  limite_credito: number
  // A view devolve `bigint` (a soma). O `number | string` e de proposito: /crediario
  // ja registra a armadilha — se o saldo da view chegar como TEXTO, somar sem
  // normalizar concatena em vez de somar, e `formatarMoeda` nao estoura com texto,
  // ele mostra o valor errado calado.
  saldo: number | string
}

/** Linha crua da tabela `clientes` (quem nao deve, ou quem casa so por CPF). */
export type LinhaCliente = {
  id: string
  nome: string
  telefone: string | null
  limite_credito: number
}

/**
 * O saldo de UM cliente, lido de `v_clientes_devedores` pelo id (a terceira
 * consulta da rota). Mesmo `number | string` de `LinhaDevedor.saldo`, e pelo mesmo
 * motivo: a view devolve `bigint` e o `Number()` e a normalizacao.
 */
export type LinhaSaldo = {
  cliente_id: string
  saldo: number | string
}

/**
 * Junta as duas origens na lista que o PDV mostra:
 *   - devedores PRIMEIRO, na ordem em que vieram (a consulta ja ordena por saldo
 *     desc: quem deve mais aparece mais em cima), com o saldo normalizado;
 *   - depois o resto, na ordem em que veio, com o saldo que `saldos` trouxer para o
 *     id — quem nao aparece na view nao deve nada para o crediario, e quem aparece
 *     (o cliente que casou SO por CPF, porque a view nao tem `cpf`) tem de mostrar a
 *     divida real, nunca zero;
 *   - id repetido entra UMA vez, na primeira ocorrencia (devedor que tambem casa a
 *     busca por nome/CPF nao pode virar duas linhas) — e o saldo do DEVEDOR vence,
 *     porque ele ja veio da view;
 *   - no maximo `limite` clientes, cortados pela ordem acima.
 */
export function juntarClientes(
  devedores: LinhaDevedor[],
  demais: LinhaCliente[],
  saldos: LinhaSaldo[] = [],
  limite: number = LIMITE_DA_BUSCA,
): ClienteDaBusca[] {
  const clientes: ClienteDaBusca[] = []
  const jaVistos = new Set<string>()
  // Normalizado UMA vez, na entrada: o segundo ramo nunca formata um texto que
  // chegou do bigint da view (a mesma armadilha documentada em `LinhaDevedor`).
  const saldoPorId = new Map(saldos.map((s) => [s.cliente_id, Number(s.saldo)]))

  for (const d of devedores) {
    if (clientes.length === limite) break
    if (jaVistos.has(d.cliente_id)) continue
    jaVistos.add(d.cliente_id)
    clientes.push({
      id: d.cliente_id,
      nome: d.nome,
      telefone: d.telefone,
      limite_credito: d.limite_credito,
      // `Number()` e a normalizacao inteira: o PDV recebe numero e nunca formata um
      // texto que chegou do bigint da view.
      saldo: Number(d.saldo),
    })
  }

  for (const c of demais) {
    if (clientes.length === limite) break
    if (jaVistos.has(c.id)) continue
    jaVistos.add(c.id)
    clientes.push({
      id: c.id,
      nome: c.nome,
      telefone: c.telefone,
      limite_credito: c.limite_credito,
      saldo: saldoPorId.get(c.id) ?? 0,
    })
  }

  return clientes
}
