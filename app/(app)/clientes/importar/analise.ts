// A planilha de clientes com saldo devedor (Task 6 da Etapa 6).
//
// Mesma forma de `lib/tabela.ts`: uma funcao PURA, sem I/O, que recebe a `Tabela`
// que o leitor de CSV/XLSX produziu e devolve as linhas ja mapeadas, as somas da
// conferencia e o JSON que a RPC `importar_clientes` (015) entende. O I/O fica em
// `actions.ts` — e por isso que o mapeamento aqui tem teste de unidade.
//
// AS TRES REGRAS QUE ESTE MODULO EXISTE PARA GARANTIR
// ---------------------------------------------------
// 1. O CPF E A CHAVE (o `unique` que a spec manda usar em 015:277-280). Linha sem
//    CPF E linha com CPF que nao tenha 11 digitos sao INVALIDAS. A RPC grava o
//    CPF como veio da planilha, sem conferir tamanho: um CPF truncado (10 digitos)
//    nao casa com o cliente que ja existe, cria um SEGUNDO cliente e lanca o saldo
//    de novo — a divida dobra sem nenhum erro aparecer. CPF de 11 digitos ausente
//    aqui nunca chega a RPC.
//
// 2. O TELEFONE PERDE O `55` DO PAIS. O `linkWhatsApp` de `clientes/validacao.ts`
//    prefixa `55` sempre; um numero que ja veio com o codigo do pais viraria
//    `wa.me/5555…`, um link morto — e a tela de cobranca e o unico jeito de avisar
//    o cliente. 12/13 digitos comecando com 55 = numero com pais: tira.
//
// 3. SOMA LIDA != SOMA GRAVADA. A soma lida e a de TUDO o que o arquivo trouxe (e
//    ela que se compara com o TOTAL que o sistema antigo imprimiu). A soma gravada
//    e a das linhas que a RPC vai receber de fato: sem CPF repetido, sem linha com
//    erro. Se as duas fossem a mesma variavel, a conferencia seria uma identidade e
//    a tarja vermelha seria codigo morto (o mesmo defeito corrigido em tabela.ts).

import { parsearCentavos } from '@/lib/dinheiro'
import { ehRodape, normalizarCabecalho, totalDoRodape } from '@/lib/tabela'
import type { Tabela } from '@/lib/csv'

export type LinhaCliente = {
  nome: string
  /** Digito puro, ou `null` quando a planilha nao trouxe telefone. */
  telefone: string | null
  /** Digito puro (11), ou `null` quando a planilha nao trouxe CPF (linha invalida). */
  cpf: string | null
  /**
   * Centavos. `null` = a planilha NAO disse o limite (coluna ausente ou celula
   * vazia) — e a chave nao viaja no JSON, que e o que faz a RPC nao mexer no
   * limite que o dono liberou. Zero e um valor LEGITIMO ("nao faz crediario",
   * spec 8.4) e viaja como zero.
   */
  limite_credito: number | null
  /** Centavos. Sem saldo na planilha = 0, que a RPC nao transforma em lancamento. */
  saldo: number
  erros: string[]
}

export type AnaliseClientes = {
  linhas: LinhaCliente[]
  /**
   * Soma dos saldos de TUDO o que o arquivo trouxe, antes de descartar as linhas
   * invalidas: e o lado que se compara com o total impresso pelo sistema antigo,
   * que somou todas as linhas dele.
   */
  somaLida: number
  /** Soma dos saldos que a RPC vai receber de fato (sem linha com erro). */
  somaGravada: number
  /**
   * O TOTAL impresso no rodape do arquivo, quando existe. `null` = o arquivo nao
   * tem rodape (ou ele e ambiguo) e NAO HA o que conferir: a tela nao afirma que
   * conferiu nem acusa divergencia.
   */
  totalImpresso: number | null
  /** Colunas obrigatorias que o cabecalho nao trouxe. */
  faltando: string[]
  /** Quantas linhas vieram sem CPF (todas invalidas: sem chave nao ha casamento). */
  semCpf: number
  /** O JSON que vai no campo escondido e chega em `importar_clientes`. */
  json: string
}

// Campos canonicos e os apelidos que cada exportador usa. A comparacao e feita com
// o cabecalho normalizado (minusculo, sem acento, `_` virou espaco) — a mesma
// `normalizarCabecalho` de lib/tabela.ts.
const APELIDOS: Record<string, string[]> = {
  nome: ['nome', 'cliente', 'nome do cliente'],
  telefone: ['telefone', 'fone', 'celular'],
  cpf: ['cpf', 'cpf/cnpj'],
  limite_credito: ['limite', 'limite credito', 'limite de credito'],
  saldo: ['saldo', 'saldo devedor', 'divida', 'debito'],
}

// CPF e obrigatorio POR LINHA na RPC (015:278). Sem a coluna, nenhuma linha pode
// ser importada — por isso ela aparece em `faltando`, e nao so em `semCpf`: a tela
// diz qual coluna procurar, em vez de acusar o arquivo inteiro linha a linha.
const OBRIGATORIOS = ['nome', 'cpf']

// As mensagens de CPF e de telefone sao as MESMAS de `clientes/validacao.ts`
// (que por sua vez espelha 015): o operador nao pode ler um texto na tela do
// cadastro e outro na importacao para o mesmo fato.
const CPF_SEM = 'Informe o CPF do cliente.'
const CPF_INVALIDO = 'CPF inválido. Use 11 dígitos.'
const TELEFONE_INVALIDO = 'Telefone inválido. Use DDD + número, como (11) 91234-5678.'

/**
 * A MARCA DO SALDO IMPORTADO, literalmente como a RPC a escreve (015:162, 205 e
 * 373 — o cabecalho da migration avisa que o texto aparece nos dois lados).
 *
 * Nao e texto de tela: e a condicao que faz a guarda do banco reconhecer que
 * aquele cliente JA recebeu o saldo do sistema antigo. Uma letra fora do lugar
 * (maiuscula, acento ou espaco) faz a guarda parar de reconhecer o lancamento; a
 * contagem da previa passa a mentir e o dono confia nela. O teste amarra o texto
 * caractere por caractere.
 *
 * Ela vive AQUI, e nao em `actions.ts`, porque este e o modulo puro da importacao
 * — e num arquivo 'use server' nao ha como testar nada.
 */
export const MARCA_SALDO_IMPORTADO = 'Saldo importado do sistema antigo'

/** `undefined` (coluna ausente) e celula vazia sao a mesma coisa aqui: nada. */
function celula(linha: string[], indice: number | undefined): string | undefined {
  if (indice === undefined) return undefined
  return linha[indice]
}

function indiceDasColunas(colunas: string[]): { mapa: Record<string, number>; faltando: string[] } {
  const normalizadas = colunas.map(normalizarCabecalho)
  const mapa: Record<string, number> = {}

  for (const [campo, apelidos] of Object.entries(APELIDOS)) {
    const indice = normalizadas.findIndex((c) => apelidos.includes(c))
    if (indice >= 0) mapa[campo] = indice
  }

  return { mapa, faltando: OBRIGATORIOS.filter((campo) => !(campo in mapa)) }
}

/**
 * Digitos do telefone, sem o `55` do pais.
 *
 * `erro: true` = o que sobrou nao e DDD + numero (10 ou 11 digitos). A linha fica
 * invalida de proposito: telefone torto no cadastro e um cliente que a tela de
 * cobranca nao alcanca, e "consertar" o numero por conta propria seria inventar
 * dado (a mesma regra do codigo de barras em tabela.ts).
 */
function lerTelefone(valor: string | undefined): { telefone: string | null; erro: boolean } {
  const digitos = (valor ?? '').replace(/\D/g, '')
  if (digitos === '') return { telefone: null, erro: false }

  const semPais =
    (digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')
      ? digitos.slice(2)
      : digitos

  if (semPais.length !== 10 && semPais.length !== 11) return { telefone: null, erro: true }
  return { telefone: semPais, erro: false }
}

/**
 * O corpo do JSON que a RPC recebe. Linha com erro NAO entra (a RPC e tudo ou
 * nada: uma linha ruim derruba a importacao inteira).
 *
 * Chave ausente e diferente de valor nulo: `telefone` e `limite_credito` so
 * viajam quando a planilha os trouxe. Sem isso, reimportar um arquivo so com nome,
 * CPF e saldo APAGARIA o telefone e o limite que o cliente ja tinha (015:347-352).
 */
function montarJson(linhas: LinhaCliente[]): string {
  const payload = linhas
    .filter((l) => l.erros.length === 0)
    .map((l) => {
      const base: Record<string, unknown> = { nome: l.nome, cpf: l.cpf, saldo: l.saldo }
      if (l.telefone !== null) base.telefone = l.telefone
      if (l.limite_credito !== null) base.limite_credito = l.limite_credito
      return base
    })

  return JSON.stringify(payload)
}

export function analisarClientes(tabela: Tabela): AnaliseClientes {
  const { mapa, faltando } = indiceDasColunas(tabela.colunas)

  const linhas: LinhaCliente[] = []
  let somaLida = 0
  let totalImpresso: number | null = null
  let semCpf = 0
  // CPFs ja usados por uma linha VALIDA. A guarda existe porque a RPC recusa o
  // arquivo INTEIRO quando um CPF se repete (015:312-320): com a linha repetida
  // marcada aqui, o dono importa o resto e ve o problema na tela, em vez de tomar
  // uma recusa seca depois de conferir a amostra.
  const jaVisto = new Set<string>()

  for (const linha of tabela.linhas) {
    if (ehRodape(linha)) {
      // O primeiro rodape manda; um segundo seria anomalia do arquivo.
      if (totalImpresso === null) totalImpresso = totalDoRodape(linha, mapa.saldo)
      continue
    }

    const erros: string[] = []

    const nome = (celula(linha, mapa.nome) ?? '').trim()
    if (nome === '') erros.push('Informe o nome do cliente.')

    const cpfDigitos = (celula(linha, mapa.cpf) ?? '').replace(/\D/g, '')
    let cpf: string | null = null
    if (cpfDigitos === '') {
      semCpf++
      erros.push(CPF_SEM)
    } else if (cpfDigitos.length !== 11) {
      erros.push(CPF_INVALIDO)
    } else {
      cpf = cpfDigitos
    }

    const { telefone, erro: telefoneInvalido } = lerTelefone(celula(linha, mapa.telefone))
    if (telefoneInvalido) erros.push(TELEFONE_INVALIDO)

    let limite: number | null = null
    const limiteTexto = celula(linha, mapa.limite_credito)
    if (mapa.limite_credito !== undefined && (limiteTexto ?? '').trim() !== '') {
      limite = parsearCentavos(limiteTexto ?? '')
      if (limite === null) erros.push('Limite de crédito inválido. Digite em reais, como 100,00.')
    }

    let saldo = 0
    const saldoTexto = celula(linha, mapa.saldo)
    if ((saldoTexto ?? '').trim() !== '') {
      const lido = parsearCentavos(saldoTexto ?? '')
      if (lido === null) erros.push('Saldo devedor inválido. Digite em reais, como 50,00.')
      else saldo = lido
    }
    // Soma de TUDO o que foi lido, inclusive da linha que vai ser recusada: e com
    // esta soma que o TOTAL impresso no arquivo se compara.
    somaLida += saldo

    if (erros.length === 0 && cpf !== null) {
      if (jaVisto.has(cpf)) {
        erros.push(`O CPF ${cpf} aparece mais de uma vez na planilha.`)
      } else {
        jaVisto.add(cpf)
      }
    }

    linhas.push({ nome, telefone, cpf, limite_credito: limite, saldo, erros })
  }

  const somaGravada = linhas
    .filter((l) => l.erros.length === 0)
    .reduce((soma, l) => soma + l.saldo, 0)

  return {
    linhas,
    somaLida,
    somaGravada,
    totalImpresso,
    faltando,
    semCpf,
    json: montarJson(linhas),
  }
}
