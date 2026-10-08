// Validacao da tela de clientes e do recebimento do crediario.
//
// Fica fora dos arquivos 'use server' de proposito (num arquivo de Server Actions
// todo export precisa ser async) e e PURA — sem Supabase, sem React, sem I/O —
// entao da para testar sem renderizar nada. Mesma escolha de caixa/validacao.ts.
//
// POR QUE AS MENSAGENS SAO COPIADAS DO BANCO, LITERALMENTE
// -------------------------------------------------------
// `cliente_salvar` (015) e `receber_pagamento` (014) ja recusam tudo o que esta
// aqui, com estas palavras. Se a tela dissesse outra coisa, o operador leria uma
// mensagem no balcao e encontraria outra no log/relatorio do mesmo fato. Por isso
// o texto abaixo e igual, caractere por caractere, ao das RPCs:
//
//   'Escreva o nome do cliente.'                        (015)
//   'O limite de crédito não pode ser negativo.'        (015)
//   'O saldo inicial não pode ser negativo.'            (015)
//   'Só o dono pode lançar saldo devedor.'              (015)
//   'O valor do recebimento precisa ser maior que zero.' (014)
//   'O valor é maior que a dívida (R$ X).'              (014, via centavos_em_reais)
//
// DINHEIRO
// --------
// Tudo e INTEIRO EM CENTAVOS e todo texto passa por `parsearCentavos`. O erro de
// fator 100 ja apareceu duas vezes neste projeto (spec 11 B3 e o PDV): "10.00" e
// DEZ REAIS, nao mil. `Number()` cru nunca entra aqui.
//
// O QUE ESTE MODULO NAO DECIDE (e por que)
// ----------------------------------------
//   * Atendente x limite de credito. A RPC compara com o valor GRAVADO: reenviar
//     o mesmo limite numa edicao de nome/telefone e permitido ao atendente, mudar
//     nao e. Sem o valor gravado (esta funcao so recebe o formulario) qualquer
//     checagem aqui recusaria a reedicao legitima — quem distingue os dois casos
//     e o banco, com a mensagem 'Só o dono pode mudar o limite de crédito.'. O
//     que a tela faz e nao oferecer o campo ao atendente (Task 4).
//   * O numero do WhatsApp ja com '+55'. A regra do projeto e prefixar 55 aos
//     digitos (spec 8.4); um telefone digitado com o codigo do pais viraria
//     55 55 ... Aqui os digitos sao apenas normalizados — nao ha heuristica de
//     pais, para o link nao depender de adivinhacao.

import { parsearCentavos } from '@/lib/dinheiro'
import { formatarMoeda } from '@/lib/format'

export type ClienteEntrada = {
  nome: string
  telefone: string
  cpf: string
  limite: string
  saldoInicial: string
}

export type ValoresCliente = {
  nome: string
  telefone: string | null
  cpf: string | null
  /** Centavos. Zero significa "nao faz crediario", nao ilimitado (spec 8.4). */
  limite: number
  /** Centavos. */
  saldoInicial: number
}

export type ResultadoCliente =
  | { ok: true; valores: ValoresCliente }
  | { ok: false; mensagem: string }

export type ResultadoRecebimento =
  | { ok: true; centavos: number }
  | { ok: false; mensagem: string }

/** Digito puro ou `null`: " " nao pode virar chave de CPF nem telefone gravado. */
function normalizarDigitos(bruto: string): string | null {
  const digitos = (bruto ?? '').replace(/\D/g, '')
  return digitos === '' ? null : digitos
}

/**
 * `parsearCentavos` do sinal: `lib/dinheiro.ts` le dinheiro DIGITADO e recusa o
 * '-', entao "-5" chega la como texto invalido. Nao da para tratar os dois casos
 * com a mesma mensagem: "Digite em reais" e um erro de digitacao, "nao pode ser
 * negativo" e uma regra. O sinal e lido aqui e o valor absoluto vai ao parser.
 * "-abc" continua invalido (o parser recusa "abc").
 *
 * EXPORTADA porque a leitura da planilha de importacao (`importar/analise.ts`)
 * precisa da MESMA distincao: sem ela, o dono leria "valor invalido" para uma
 * divida negativa que o banco recusa justamente por ser negativa.
 */
export function parsearComSinal(texto: string): number | null {
  const semEspaco = (texto ?? '').replace(/R\$/gi, '').replace(/[\s\u00A0]/g, '')
  const negativo = semEspaco.startsWith('-')
  const centavos = parsearCentavos(negativo ? semEspaco.slice(1) : texto)
  if (centavos === null) return null
  return negativo ? -centavos : centavos
}

/**
 * Campo de dinheiro em branco vale zero (o campo nao apareceu na tela); o resto
 * passa pelo parser do projeto. Devolve `null` quando o texto nao e dinheiro.
 */
function lerCentavos(texto: string): number | null {
  const limpo = (texto ?? '').trim()
  if (limpo === '') return 0
  return parsearComSinal(limpo)
}

/**
 * Cadastro/edicao de cliente. Espelha `cliente_salvar` (015) antes da ida ao
 * banco, na mesma ordem das guardas: nome, CPF/telefone, limite, saldo, papel.
 */
export function validarCliente(entrada: ClienteEntrada, ehDono: boolean): ResultadoCliente {
  const nome = (entrada.nome ?? '').trim()
  if (nome === '') {
    return { ok: false, mensagem: 'Escreva o nome do cliente.' }
  }

  // A RPC nao confere tamanho de CPF/telefone; aqui confere porque o `unique` do
  // CPF e a chave de casamento da importacao — um CPF truncado cria um cliente
  // novo em vez de casar com o existente, e o saldo dele entra duas vezes.
  const cpf = normalizarDigitos(entrada.cpf)
  if (cpf !== null && cpf.length !== 11) {
    return { ok: false, mensagem: 'CPF inválido. Use 11 dígitos.' }
  }

  const telefone = normalizarDigitos(entrada.telefone)
  if (telefone !== null && telefone.length !== 10 && telefone.length !== 11) {
    return { ok: false, mensagem: 'Telefone inválido. Use DDD + número, como (11) 91234-5678.' }
  }

  const limite = lerCentavos(entrada.limite)
  if (limite === null) {
    return { ok: false, mensagem: 'Limite de crédito inválido. Digite em reais, como 100,00.' }
  }
  if (limite < 0) {
    return { ok: false, mensagem: 'O limite de crédito não pode ser negativo.' }
  }

  const saldoInicial = lerCentavos(entrada.saldoInicial)
  if (saldoInicial === null) {
    return { ok: false, mensagem: 'Saldo inicial inválido. Digite em reais, como 50,00.' }
  }
  if (saldoInicial < 0) {
    return { ok: false, mensagem: 'O saldo inicial não pode ser negativo.' }
  }

  // Saldo devedor e do dono (spec 5). Saldo zero ou vazio nao e lancamento: e a
  // edicao normal de nome/telefone que o atendente faz o dia inteiro.
  if (!ehDono && saldoInicial > 0) {
    return { ok: false, mensagem: 'Só o dono pode lançar saldo devedor.' }
  }

  return { ok: true, valores: { nome, telefone, cpf, limite, saldoInicial } }
}

/**
 * Recebimento no balcao. `divida` vem da view do saldo (centavos) e serve so para
 * a tela: o teto de verdade e checado dentro de `receber_pagamento`, com o cliente
 * travado. Recusar aqui evita a ida ao banco; nao substitui a RPC.
 */
export function validarRecebimento(valor: string, divida: number): ResultadoRecebimento {
  const centavos = parsearComSinal((valor ?? '').trim())
  if (centavos === null) {
    return { ok: false, mensagem: 'Valor inválido. Use, por exemplo, 20,00.' }
  }
  // O texto e o da RPC (`014_receber_pagamento.sql:56`), nao uma versao curta: ha
  // caminhos que chegam ao banco e mostrariam o outro texto para o mesmo fato.
  if (centavos <= 0) {
    return { ok: false, mensagem: 'O valor do recebimento precisa ser maior que zero.' }
  }

  // Nunca gerar saldo credor (spec 8.4): um centavo acima da divida e recusado, e
  // divida zerada nao vira credito. A mensagem e a da spec 9 / da RPC 014.
  // (Divida negativa e anomalia — o estorno do cancelamento pode deixar saldo
  // credor gravado; nesse caso o Intl escreve "-R$ 20,00" e o `centavos_em_reais`
  // do banco escreveria "R$ -20,00". O numero e o mesmo; so o sinal muda de lugar.)
  if (centavos > divida) {
    return { ok: false, mensagem: `O valor é maior que a dívida (${formatarMoeda(divida)}).` }
  }

  return { ok: true, centavos }
}

/** "11912345678" -> "(11) 91234-5678". Nao e telefone valido -> `null`. */
export function formatarTelefone(bruto: string): string | null {
  const digitos = normalizarDigitos(bruto)
  if (digitos === null) return null

  if (digitos.length === 11) {
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`
  }
  if (digitos.length === 10) {
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`
  }
  return null
}

/**
 * Link de cobranca no WhatsApp (spec 8.4): ele apenas ABRE o `wa.me` com a
 * mensagem pronta — nada e enviado por este sistema. O operador confere e aperta
 * enviar no WhatsApp dele.
 *
 * Sem telefone nao ha link (`null`): a tela diz "Cliente sem telefone cadastrado."
 * Nome vazio nao vira "Olá, !" — a saudacao perde a virgula e o nome.
 */
export function linkWhatsApp(telefone: string | null, nome: string, saldo: number): string | null {
  const digitos = normalizarDigitos(telefone ?? '')
  if (digitos === null) return null

  const nomeLimpo = (nome ?? '').trim()
  const saudacao = nomeLimpo === '' ? 'Olá!' : `Olá, ${nomeLimpo}!`
  const mensagem = `${saudacao} Seu saldo na farmácia é ${formatarMoeda(saldo)}. Podemos acertar?`

  return `https://wa.me/55${digitos}?text=${encodeURIComponent(mensagem)}`
}
