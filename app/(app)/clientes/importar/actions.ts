'use server'

import { revalidatePath } from 'next/cache'
import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'
import { lerCsv, pareceLatin1, type Tabela } from '@/lib/csv'
import { lerXlsx } from '@/lib/xlsx'
import { detectarFormato } from '@/lib/tabela'
import { formatarMoeda } from '@/lib/format'
import { formatarTelefone } from '../validacao'
import { analisarClientes, MARCA_SALDO_IMPORTADO } from './analise'

// Duas acoes, e nao uma, pelo MESMO motivo de produtos/importar: a importacao tem
// duas viagens de proposito. A primeira le e confere (sem gravar nada — a escrita
// e a RPC, e ela so roda na segunda viagem); a segunda grava. O arquivo nao volta
// ao cliente: o que viaja e o JSON ja validado, num campo oculto.
//
// IMPORTAR E ATO DE DONO (spec 5): as duas acoes checam o papel aqui E a RPC checa
// de novo (015:250). Campo escondido no navegador o operador consegue inventar; a
// guarda de verdade e a do banco.

export type Previa = {
  colunas: Tabela['colunas']
  primeiras: string[][]
  /** Quantas linhas de cliente o arquivo trouxe (o rodape TOTAL nao conta). */
  totalLinhas: number
  validas: number
  invalidas: number
  /*
   * O par que a tela confere: o TOTAL impresso no arquivo (aritmetica do sistema
   * antigo) contra a soma que o NOSSO leitor vai gravar. Quando nao ha rodape, o
   * total e `null` e nao se afirma que conferiu.
   */
  totalImpresso: number | null
  /** Soma de TUDO o que o arquivo trouxe — e com ela que o total impresso se compara. */
  somaLida: number
  /** Soma do que a RPC vai receber de fato (sem CPF repetido, sem linha com erro). */
  somaGravada: number
  /** true SOMENTE quando existe total impresso e ele bate ao centavo. */
  somaConferida: boolean
  /** Linhas sem CPF (todas invalidas: sem a chave nao ha casamento). */
  semCpf: number
  /*
   * A escolha do checkbox da tela VIAJA no estado: sao dois formularios (o de
   * analise e o de confirmacao) e o de confirmacao precisa mandar a escolha FEITA
   * na analise — foi um `sim` fixo no segundo form que tornou o checkbox inerte
   * (defeito f120328).
   */
  atualizar: boolean
  /*
   * Quantos CPFs do arquivo ja existem no cadastro. `null` = nao foi possivel
   * conferir (erro na consulta) e a tela diz isso, em vez de afirmar zero.
   */
  existentes: number | null
  /*
   * Quantos desses clientes JA TEM o saldo importado lancado (a marca literal da
   * 015). O saldo deles sera IGNORADO pela RPC e contado em `saldos_ignorados`
   * — este numero e o aviso que impede o dono de achar que a reimportacao vai
   * somar de novo. `null` = nao foi possivel conferir.
   */
  comSaldoLancado: number | null
  faltando: string[]
  avisos: string[]
  erros: { linha: number; erros: string[] }[]
  json: string
}

export type Resumo = {
  criados: number
  atualizados: number
  ignorados: number
  saldos_lancados: number
  saldos_ignorados: number
}

export type ResultadoAnalise =
  | { ok: true; previa: Previa }
  | { ok: false; mensagem: string }

export type ResultadoImportacao =
  | { ok: true; resumo: Resumo }
  | { ok: false; mensagem: string }

const SO_O_DONO = 'Só o dono pode importar clientes.'

/**
 * Quantos dos CPFs da planilha ja existem no cadastro, e os ids deles.
 *
 * Em LOTES de proposito: um `.in()` com milhares de CPFs estoura o tamanho da URL
 * da requisicao. Duas centenas por vez mantem a consulta pequena.
 *
 * `null` quando a consulta falha: a tela precisa dizer "nao consegui conferir" em
 * vez de mostrar zero — um zero inventado aqui e a previa afirmando que nenhum
 * saldo vai ser ignorado (o defeito que a revisao da Task 5 pegou na tela de
 * crediario: erro descartado virando "Ninguem devendo no crediario.").
 */
async function contarExistentes(
  supabase: Awaited<ReturnType<typeof criarClienteServidor>>,
  cpfs: string[],
): Promise<Map<string, string> | null> {
  const LOTE = 200
  // Mapa cpf -> id: quem chama precisa dos ids so das linhas com saldo > 0 (a
  // contagem de saldos ignorados), e uma segunda consulta por CPF seria uma ida ao
  // banco a mais para a mesma pergunta.
  const porCpf = new Map<string, string>()

  for (let i = 0; i < cpfs.length; i += LOTE) {
    const { data, error } = await supabase
      .from('clientes')
      .select('id, cpf')
      .in('cpf', cpfs.slice(i, i + LOTE))
    if (error) return null
    for (const c of (data ?? []) as { id: string; cpf: string }[]) porCpf.set(c.cpf, c.id)
  }

  return porCpf
}

/**
 * Quantos dos clientes ja cadastrados tem o saldo importado lancado — a mesma
 * condicao da guarda da RPC (015:369-373): lancamento `compra`, sem venda, com a
 * marca. O `Set` e por `cliente_id` porque a pergunta e "quantos CLIENTES", e nao
 * quantos lancamentos (a guarda garante um por cliente, mas a leitura nao depende
 * disso).
 *
 * Limitacao conhecida (a mesma de `contarExistentes` em produtos): a contagem e
 * feita FORA da transacao da RPC. Um saldo lancado em outro terminal entre a
 * analise e a confirmacao nao aparece aqui — a guarda do banco continua valendo, e
 * este numero e para orientar a decisao humana, nao uma garantia transacional.
 */
async function contarComSaldoLancado(
  supabase: Awaited<ReturnType<typeof criarClienteServidor>>,
  ids: string[],
): Promise<number | null> {
  // Lote MENOR que o de CPF: um uuid tem 36 caracteres (o CPF tem 11), entao 100
  // ja dao ~3,8 kB de URL. A lista inteira num `.in()` so estoura o tamanho da
  // requisicao e a previa diria "nao consegui conferir".
  const LOTE = 100
  const comSaldo = new Set<string>()

  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await supabase
      .from('crediario_lancamentos')
      .select('cliente_id')
      .eq('tipo', 'compra')
      .is('venda_id', null)
      .eq('observacao', MARCA_SALDO_IMPORTADO)
      .in('cliente_id', ids.slice(i, i + LOTE))
    if (error) return null
    for (const l of (data ?? []) as { cliente_id: string }[]) comSaldo.add(l.cliente_id)
  }

  return comSaldo.size
}

// Assinatura exigida pelo useActionState: o estado anterior vem primeiro (doc do
// Next 16, app/guides/forms.md). O primeiro parametro nao e usado aqui.
export async function analisarClientesArquivo(
  _estadoAnterior: ResultadoAnalise | null,
  formData: FormData,
): Promise<ResultadoAnalise> {
  const perfil = await perfilAtual()
  if (!perfil) return { ok: false, mensagem: 'Usuário sem perfil cadastrado. Fale com o responsável.' }
  if (perfil.papel !== 'dono') return { ok: false, mensagem: SO_O_DONO }

  const arquivo = formData.get('arquivo')
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, mensagem: 'Escolha um arquivo .xlsx ou .csv.' }
  }

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const formato = detectarFormato(arquivo.name, bytes)
  const avisos: string[] = []
  let tabela: Tabela

  try {
    if (formato === 'xlsx') {
      tabela = lerXlsx(bytes)
    } else if (formato === 'csv') {
      // O export antigo vem em Latin-1: sem isto os acentos chegam quebrados e o
      // nome do cliente entra errado no cadastro (e a cobranca no WhatsApp sai
      // "Olá, Jos?").
      const latin1 = pareceLatin1(bytes)
      if (latin1) {
        avisos.push(
          'O arquivo está em Latin-1 (padrão antigo do Windows). Os acentos foram convertidos — confira os nomes antes de confirmar.',
        )
      }
      tabela = lerCsv(new TextDecoder(latin1 ? 'windows-1252' : 'utf-8').decode(bytes))
    } else {
      return {
        ok: false,
        mensagem:
          'Formato não reconhecido. Envie uma planilha .xlsx ou um arquivo .csv com a lista de clientes.',
      }
    }
  } catch (erro) {
    // A mensagem de lerXlsx ja vem em portugues e explicando o que fazer.
    return { ok: false, mensagem: erro instanceof Error ? erro.message : 'Não foi possível ler o arquivo.' }
  }

  const analise = analisarClientes(tabela)

  // A escolha do checkbox vem do formulario de ANALISE e segue no estado ate o de
  // CONFIRMACAO (defeito f120328: o segundo form mandava `sim` fixo).
  const atualizar = formData.get('atualizar') === 'sim'

  const supabase = await criarClienteServidor()
  const cpfs = [
    ...new Set(
      analise.linhas
        .filter((l) => l.erros.length === 0 && l.cpf !== null)
        .map((l) => l.cpf as string),
    ),
  ]
  const existentesPorCpf = await contarExistentes(supabase, cpfs)

  /*
   * A contagem de "saldos ignorados" so olha as linhas com saldo MAIOR que zero:
   * a RPC so entra no bloco da guarda quando `(v_linha->>'saldo')::integer > 0`
   * (015:368) — um cliente com saldo 0 na planilha nunca aparece em
   * `saldos_ignorados`, e conta-lo aqui faria a previa superestimar o aviso.
   */
  const cpfsComSaldo = [
    ...new Set(
      analise.linhas
        .filter((l) => l.erros.length === 0 && l.cpf !== null && l.saldo > 0)
        .map((l) => l.cpf as string),
    ),
  ]
  const idsComSaldo = cpfsComSaldo
    .map((cpf) => existentesPorCpf?.get(cpf))
    .filter((id): id is string => id !== undefined)

  const comSaldoLancado =
    existentesPorCpf === null ? null : await contarComSaldoLancado(supabase, idsComSaldo)

  const erros = analise.linhas
    .map((l, i) => ({ linha: i + 1, erros: l.erros }))
    .filter((e) => e.erros.length > 0)

  const previa: Previa = {
    colunas: tabela.colunas,
    // AMOSTRA DA PREVIA: e ela que o dono confere antes de confirmar — nome,
    // telefone, CPF, limite e saldo das OITO primeiras linhas que serao gravadas.
    // Nomes de cliente se repetem e CPF nao se confere de relance: a amostra e o
    // que pega coluna trocada no arquivo.
    primeiras: analise.linhas
      .filter((l) => l.erros.length === 0)
      .slice(0, 8)
      .map((l) => [
        l.nome,
        formatarTelefone(l.telefone ?? '') ?? '',
        l.cpf ?? '',
        // `null` = a planilha nao disse o limite; a celula fica vazia em vez de
        // mostrar "R$ 0,00" para um limite que ninguem informou.
        l.limite_credito === null ? '' : formatarMoeda(l.limite_credito),
        formatarMoeda(l.saldo),
      ]),
    totalLinhas: analise.linhas.length,
    validas: analise.linhas.filter((l) => l.erros.length === 0).length,
    invalidas: analise.linhas.filter((l) => l.erros.length > 0).length,
    totalImpresso: analise.totalImpresso,
    somaLida: analise.somaLida,
    somaGravada: analise.somaGravada,
    // A regra da conferencia fica em UM lugar so (a analise nao devolve este
    // booleano): total impresso E igualdade ao centavo. Sem total, e false.
    somaConferida: analise.totalImpresso !== null && analise.totalImpresso === analise.somaLida,
    semCpf: analise.semCpf,
    atualizar,
    existentes: existentesPorCpf === null ? null : existentesPorCpf.size,
    comSaldoLancado,
    faltando: analise.faltando,
    // Os avisos do leitor do arquivo (Latin-1) e os da analise (ex.: planilha sem
    // a coluna de saldo) chegam juntos na tela, como em produtos/importar.
    avisos: [...avisos, ...analise.avisos],
    erros,
    json: analise.json,
  }

  return { ok: true, previa }
}

export async function confirmarImportacaoClientes(
  _estadoAnterior: ResultadoImportacao | null,
  formData: FormData,
): Promise<ResultadoImportacao> {
  const perfil = await perfilAtual()
  if (!perfil) return { ok: false, mensagem: 'Usuário sem perfil cadastrado. Fale com o responsável.' }
  if (perfil.papel !== 'dono') return { ok: false, mensagem: SO_O_DONO }

  const bruto = formData.get('linhas')
  if (typeof bruto !== 'string' || bruto.trim() === '') {
    return { ok: false, mensagem: 'Nenhuma linha para importar.' }
  }

  let linhas: unknown
  try {
    linhas = JSON.parse(bruto)
  } catch {
    return { ok: false, mensagem: 'Nenhuma linha para importar.' }
  }
  if (!Array.isArray(linhas) || linhas.length === 0) {
    return { ok: false, mensagem: 'Nenhuma linha para importar.' }
  }

  const supabase = await criarClienteServidor()
  const { data, error } = await supabase.rpc('importar_clientes', {
    p_linhas: linhas,
    p_atualizar_existentes: formData.get('atualizar') === 'sim',
  })

  if (error) {
    // A mensagem da RPC ja vem em portugues e nomeando a linha.
    return { ok: false, mensagem: error.message }
  }

  // A lista de clientes e a de quem deve podem estar abertas em outra aba do
  // balcao: o saldo acabou de mudar nas duas.
  revalidatePath('/clientes')
  revalidatePath('/crediario')
  return { ok: true, resumo: data as Resumo }
}
