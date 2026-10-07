'use server'

import { revalidatePath } from 'next/cache'
import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'
import { lerCsv, pareceLatin1, type Tabela } from '@/lib/csv'
import { lerXlsx } from '@/lib/xlsx'
import { lerPdf } from '@/lib/pdf'
import { analisarTabela, detectarFormato, type ColunasPresentes } from '@/lib/tabela'
import { formatarMoeda } from '@/lib/format'
import { paraOLinhasJson } from './preparacao'

// Duas acoes, e nao uma, porque a importacao tem DUAS viagens de proposito:
// a primeira le e confere (sem gravar nada), a segunda grava. O arquivo nao
// volta ao cliente — o que viaja e o JSON ja validado, num campo oculto.

export type Previa = {
  colunas: Tabela['colunas']
  primeiras: string[][]
  /** Quantas linhas de produto o arquivo trouxe, antes de qualquer filtro. */
  totalLinhas: number
  validas: number
  invalidas: number
  descartadas: number
  /*
   * O par que a tela confere: o TOTAL impresso no arquivo (aritmetica do sistema
   * antigo) contra a soma que o NOSSO leitor vai gravar. Antes os dois campos
   * saiam da mesma variavel e a conferencia nao existia de verdade.
   */
  totalImpresso: number | null
  somaGravada: number
  somaConferida: boolean
  /* Colunas opcionais que a planilha trouxe. Ausente = a RPC nao mexe no campo. */
  colunasPresentes: ColunasPresentes
  /*
   * A escolha do checkbox da tela VIAJA no estado: sao dois formularios (o de
   * analise e o de confirmacao) e antes o de confirmacao mandava `sim` fixo, o
   * que tornava o checkbox inerte — desmarcar e confirmar atualizava tudo igual.
   */
  atualizar: boolean
  /** Quantos codigos da planilha ja existem no catalogo. */
  existentes: number
  faltando: string[]
  avisos: string[]
  erros: { linha: number; erros: string[] }[]
  json: string
}

export type Resumo = { criados: number; atualizados: number; ignorados: number }

export type ResultadoAnalise =
  | { ok: true; previa: Previa }
  | { ok: false; mensagem: string }

export type ResultadoImportacao =
  | { ok: true; resumo: Resumo }
  | { ok: false; mensagem: string }

const SO_O_DONO = 'Só o dono pode importar produtos.'

/**
 * O PDF do sistema antigo (`%PDF`). A checagem e pela ASSINATURA, e nao pela
 * extensao: um PDF renomeado para .csv chegaria aqui como texto e sairia com os
 * bytes binarios interpretados como planilha.
 */
function ehPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  )
}

/**
 * Quantos dos codigos da planilha JA existem no catalogo.
 *
 * Em LOTES de proposito: um `.in()` com milhares de codigos estoura o tamanho da
 * URL da requisicao. Duas centenas por vez mantem a consulta pequena e o numero
 * e o que o dono precisa ver antes de confirmar uma reimportacao.
 *
 * Limitacao conhecida: a contagem e feita FORA da transacao da RPC, entao uma
 * venda de outro terminal entre a analise e a confirmacao pode criar um produto
 * que ainda nao estava contado. E um numero para orientar a decisao humana, nao
 * uma garantia transacional.
 */
async function contarExistentes(
  supabase: Awaited<ReturnType<typeof criarClienteServidor>>,
  codigos: string[],
): Promise<number> {
  const LOTE = 200
  let total = 0
  for (let i = 0; i < codigos.length; i += LOTE) {
    const { count } = await supabase
      .from('produtos')
      .select('id', { count: 'exact', head: true })
      .in('codigo_barras', codigos.slice(i, i + LOTE))
    total += count ?? 0
  }
  return total
}

// Assinatura exigida pelo useActionState: o estado anterior vem primeiro (doc do
// Next 16, app/guides/forms.md). O primeiro parametro nao e usado aqui.
export async function analisarArquivo(
  _estadoAnterior: ResultadoAnalise | null,
  formData: FormData,
): Promise<ResultadoAnalise> {
  const perfil = await perfilAtual()
  if (!perfil) return { ok: false, mensagem: 'Usuário sem perfil cadastrado. Fale com o responsável.' }
  if (perfil.papel !== 'dono') return { ok: false, mensagem: SO_O_DONO }

  const arquivo = formData.get('arquivo')
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, mensagem: 'Escolha um arquivo .xlsx, .csv ou .pdf.' }
  }

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const formato = detectarFormato(arquivo.name, bytes)
  const avisos: string[] = []
  let tabela: Tabela

  try {
    if (formato === 'xlsx') {
      tabela = lerXlsx(bytes)
    } else if (formato === 'csv') {
      // O PDF do sistema antigo tambem e "csv" para o `detectarFormato` (ele so
      // distingue xlsx de texto). A assinatura `%PDF` vem primeiro, pela mesma
      // regra do modulo: o conteudo manda, a extensao mente.
      if (ehPdf(bytes)) {
        // O leitor recusa com a mensagem certa quando nao ha grade na pagina.
        tabela = lerPdf(bytes)
      } else {
        // O export antigo vem em Latin-1: sem isto os acentos chegam quebrados e
        // o nome do produto entra errado no cadastro.
        const latin1 = pareceLatin1(bytes)
        if (latin1) {
          avisos.push(
            'O arquivo está em Latin-1 (padrão antigo do Windows). Os acentos foram convertidos — confira os nomes antes de confirmar.',
          )
        }
        tabela = lerCsv(new TextDecoder(latin1 ? 'windows-1252' : 'utf-8').decode(bytes))
      }
    } else {
      return {
        ok: false,
        mensagem: 'Formato não reconhecido. Envie uma planilha .xlsx, um arquivo .csv ou o PDF do sistema antigo.',
      }
    }
  } catch (erro) {
    // As mensagens de lerXlsx e lerPdf ja vem em portugues e explicando o que fazer.
    return { ok: false, mensagem: erro instanceof Error ? erro.message : 'Não foi possível ler o arquivo.' }
  }

  const analise = analisarTabela(tabela)

  // A escolha do checkbox vem do formulario de ANALISE e segue no estado ate o de
  // CONFIRMACAO: sem isso o segundo form mandava `sim` fixo e o checkbox nao
  // valia nada.
  const atualizar = formData.get('atualizar') === 'sim'

  const supabase = await criarClienteServidor()
  const codigos = [
    ...new Set(
      analise.linhas
        .filter((l) => l.erros.length === 0 && l.codigo_barras !== null)
        .map((l) => l.codigo_barras as string),
    ),
  ]
  const existentes = await contarExistentes(supabase, codigos)

  const erros = analise.linhas
    .map((l, i) => ({ linha: i + 1, erros: l.erros }))
    .filter((e) => e.erros.length > 0)

  const previa: Previa = {
    colunas: tabela.colunas,
    // AMOSTRA DA PREVIA: e ela que o dono confere antes de confirmar, e o unico
    // criterio de aceite quando o arquivo nao tem total impresso (o PDF do
    // sistema antigo nao tem). Oito linhas cabem na tela e ja mostram produto,
    // codigo e preco de cada uma.
    primeiras: analise.linhas
      .filter((l) => l.erros.length === 0)
      .slice(0, 8)
      .map((l) => [
        l.codigo_barras ?? '',
        l.nome,
        l.categoria ?? '',
        l.unidade,
        formatarMoeda(l.preco_custo),
        formatarMoeda(l.preco_venda),
        l.estoque_atual === null ? '' : String(l.estoque_atual),
        String(l.estoque_minimo),
      ]),
    totalLinhas: analise.linhas.length,
    validas: analise.validas,
    invalidas: analise.invalidas,
    descartadas: analise.descartadas,
    totalImpresso: analise.totalImpresso,
    somaGravada: analise.somaGravada,
    somaConferida: analise.somaConferida,
    colunasPresentes: analise.colunasPresentes,
    atualizar,
    existentes,
    faltando: analise.faltando,
    avisos: [...avisos, ...analise.avisos],
    erros,
    json: JSON.stringify(paraOLinhasJson(analise.linhas, analise.colunasPresentes)),
  }

  return { ok: true, previa }
}

export async function confirmarImportacao(
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
  const { data, error } = await supabase.rpc('importar_produtos', {
    p_linhas: linhas,
    p_atualizar_existentes: formData.get('atualizar') === 'sim',
  })

  if (error) {
    // A mensagem da RPC ja vem em portugues e nomeando a linha.
    return { ok: false, mensagem: error.message }
  }

  // A lista de produtos ja pode estar aberta em outra aba do balcao.
  revalidatePath('/produtos')
  return { ok: true, resumo: data as Resumo }
}
