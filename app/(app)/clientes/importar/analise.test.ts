import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { analisarClientes, MARCA_SALDO_IMPORTADO } from './analise'
import { lerXlsx } from '@/lib/xlsx'
import { LIMITE_DE_CENTAVOS } from '@/lib/tabela'
import type { Tabela } from '@/lib/csv'

// Testes da ANALISE da planilha de clientes — a parte pura, sem I/O e sem
// Supabase. O que eles protegem:
//
//   1. o CPF e a CHAVE de casamento da importacao (015:277-280): linha sem CPF e
//      linha com CPF que nao tenha 11 digitos NAO vao para a RPC. Um CPF truncado
//      cria um cliente novo em vez de casar com o existente — e o saldo dele entra
//      duas vezes (o dano do Review Focus 1).
//   2. o `55` do pais sai do telefone: com ele o link `wa.me` sai `5555…`, morto
//      (handoff da Task 3).
//   3. a soma LIDA (tudo o que o arquivo trouxe) e diferente da soma GRAVADA (o
//      que a RPC vai receber): e com a lida que o TOTAL impresso se compara.

function tabela(colunas: string[], linhas: string[][]): Tabela {
  return { colunas, linhas }
}

/** A fixture binaria gerada por `.superpowers/gerar-fixture-clientes.py`. */
function tabelaDaFixture(nome: string): Tabela {
  return lerXlsx(new Uint8Array(fs.readFileSync(path.join('tests', 'fixtures', nome))))
}

describe('analisarClientes', () => {
  it('reconhece cabeçalhos com acento, com espaço e por apelido', () => {
    const r = analisarClientes(
      tabela(
        ['Nome do Cliente', 'Fone', 'CPF', 'Limite de Crédito', 'Saldo Devedor'],
        [['MARIA DA SILVA', '(11) 91234-5678', '111.444.777-35', '100,00', '123,45']],
      ),
    )

    expect(r.faltando).toEqual([])
    expect(r.linhas[0]).toMatchObject({
      nome: 'MARIA DA SILVA',
      // Digito puro: e assim que a RPC grava (015:277) e que o `wa.me` funciona.
      telefone: '11912345678',
      cpf: '11144477735',
      limite_credito: 10000,
      saldo: 12345,
      erros: [],
    })
  })

  it('lê o saldo e o limite por parsearCentavos (vírgula decimal e milhar)', () => {
    const r = analisarClientes(
      tabela(
        ['nome', 'cpf', 'limite', 'saldo'],
        [
          ['A', '11144477735', '1.234,56', '123,45'],
          ['B', '22255588846', '0', '1.234,56'],
        ],
      ),
    )

    expect(r.linhas.map((l) => l.saldo)).toEqual([12345, 123456])
    expect(r.linhas.map((l) => l.limite_credito)).toEqual([123456, 0])
    expect(r.somaLida).toBe(12345 + 123456)
    expect(r.somaGravada).toBe(12345 + 123456)
  })

  it('conta a linha sem CPF em `semCpf` e a deixa inválida', () => {
    const r = analisarClientes(
      tabela(
        ['nome', 'cpf', 'saldo'],
        [
          ['A', '11144477735', '10,00'],
          ['B', '', '10,00'],
        ],
      ),
    )

    expect(r.semCpf).toBe(1)
    expect(r.linhas[1].erros).toContain('Informe o CPF do cliente.')
    // A linha invalida nao chega ao banco: a RPC recusaria o arquivo INTEIRO
    // (tudo ou nada) por causa dela.
    expect(JSON.parse(r.json)).toHaveLength(1)
    expect(r.somaGravada).toBe(1000)
  })

  it('rejeita CPF que não tenha 11 dígitos (curto E longo)', () => {
    const r = analisarClientes(
      tabela(
        ['nome', 'cpf'],
        [
          ['A', '123.456.789-0'],
          ['B', '123456789012'],
        ],
      ),
    )

    expect(r.linhas[0].erros).toContain('CPF inválido. Use 11 dígitos.')
    expect(r.linhas[1].erros).toContain('CPF inválido. Use 11 dígitos.')
    // CPF presente e errado nao e "sem CPF": sao duas mensagens diferentes.
    expect(r.semCpf).toBe(0)
    expect(JSON.parse(r.json)).toHaveLength(0)
  })

  it('tira o 55 do telefone quando ele tem 12 ou 13 dígitos', () => {
    const r = analisarClientes(
      tabela(
        ['nome', 'cpf', 'telefone'],
        [
          ['A', '11144477735', '55 11 91234-5678'],
          ['B', '22255588846', '551191234567'],
        ],
      ),
    )

    expect(r.linhas[0].telefone).toBe('11912345678')
    expect(r.linhas[1].telefone).toBe('1191234567')
    expect(r.linhas[0].erros).toEqual([])
    expect(r.linhas[1].erros).toEqual([])
  })

  it('trata como inválido o telefone que não sobra 10/11 dígitos', () => {
    const r = analisarClientes(
      tabela(
        ['nome', 'cpf', 'telefone'],
        [
          ['A', '11144477735', '123'],
          ['B', '22255588846', '5511'],
          ['C', '33366699957', '011912345678'],
        ],
      ),
    )

    const msg = 'Telefone inválido. Use DDD + número, como 11 91234-5678.'
    expect(r.linhas.map((l) => l.erros)).toEqual([[msg], [msg], [msg]])
    expect(JSON.parse(r.json)).toHaveLength(0)
  })

  it('não invalida a linha sem telefone: o campo é opcional', () => {
    const r = analisarClientes(tabela(['nome', 'cpf', 'telefone'], [['A', '11144477735', '']]))
    const json = JSON.parse(r.json)

    expect(r.linhas[0].telefone).toBeNull()
    expect(r.linhas[0].erros).toEqual([])
    // Chave AUSENTE = "nao mexe" no telefone de quem ja existe (015:347-349).
    expect('telefone' in json[0]).toBe(false)
  })

  it('não manda `limite_credito` quando a célula está vazia (não zera o limite)', () => {
    const r = analisarClientes(
      tabela(
        ['nome', 'cpf', 'limite'],
        [
          ['A', '11144477735', '100,00'],
          ['B', '22255588846', ''],
        ],
      ),
    )
    const json = JSON.parse(r.json)

    expect(json[0].limite_credito).toBe(10000)
    expect('limite_credito' in json[1]).toBe(false)
  })

  it('CPF repetido: só a PRIMEIRA linha com o CPF vale', () => {
    const r = analisarClientes(
      tabela(
        ['nome', 'cpf', 'saldo'],
        [
          ['A', '11144477735', '100,00'],
          ['B', '111.444.777-35', '50,00'],
          ['C', '22255588846', '10,00'],
        ],
      ),
    )

    expect(r.linhas[0].erros).toEqual([])
    expect(r.linhas[1].erros).toEqual(['O CPF 11144477735 aparece mais de uma vez na planilha.'])
    // A repetida continua na soma LIDA (o sistema antigo somou as duas linhas
    // dele) e sai da soma GRAVADA (a RPC nao vai receber essa linha).
    expect(r.somaLida).toBe(10000 + 5000 + 1000)
    expect(r.somaGravada).toBe(10000 + 1000)
    expect(JSON.parse(r.json)).toHaveLength(2)
  })

  it('o rodapé TOTAL vira `totalImpresso` e não vira cliente', () => {
    const r = analisarClientes(
      tabela(
        ['nome', 'cpf', 'saldo_devedor'],
        [
          ['A', '11144477735', '100,00'],
          ['TOTAL', '', '278,90'],
        ],
      ),
    )

    expect(r.totalImpresso).toBe(27890)
    expect(r.linhas).toHaveLength(1)
  })

  it('sem rodapé TOTAL, `totalImpresso` é null (não se inventa conferência)', () => {
    const r = analisarClientes(tabela(['nome', 'cpf', 'saldo'], [['A', '11144477735', '10,00']]))
    expect(r.totalImpresso).toBeNull()
  })

  it('rodapé sem coluna de saldo reconhecida usa a única célula de dinheiro', () => {
    const r = analisarClientes(
      tabela(
        ['nome', 'cpf'],
        [
          ['A', '11144477735'],
          ['TOTAL', '278,90'],
        ],
      ),
    )
    expect(r.totalImpresso).toBe(27890)
  })

  it('aponta as colunas obrigatórias que faltam: nome e CPF', () => {
    expect(analisarClientes(tabela(['cliente_x', 'saldo'], [])).faltando).toEqual(['nome', 'cpf'])
  })

  it('saldo ilegível vira erro na linha, e "10.00" é DEZ reais (sem fator 100)', () => {
    const r = analisarClientes(
      tabela(
        ['nome', 'cpf', 'saldo'],
        [
          ['A', '11144477735', 'abc'],
          ['B', '22255588846', '10.00'],
        ],
      ),
    )

    expect(r.linhas[0].erros).toContain('Saldo devedor inválido. Digite em reais, como 50,00.')
    expect(r.linhas[1].saldo).toBe(1000)
    expect(JSON.parse(r.json)).toHaveLength(1)
  })

  // Handoff 1: a marca e o LITERAL que a RPC ja usa (015:162, 205 e 373). Ela e a
  // condicao da guarda contra dobrar a divida, e a previa conta por ela quantos
  // saldos serao ignorados. Um caractere diferente aqui quebra a guarda em
  // silencio: o teste existe para a mudanca ser barulhenta.
  it('a marca do saldo importado é o literal da RPC', () => {
    expect(MARCA_SALDO_IMPORTADO).toBe('Saldo importado do sistema antigo')
  })

  // Important 1 da revisao: `limite_credito` e `saldo` sao `integer` no banco, e a
  // RPC faz `::integer` (015:289, 304). Um valor acima do teto estourava o cast e
  // abortava a importacao INTEIRA com erro cru em ingles — e a previa dizia que
  // estava tudo certo. O teto e o MESMO de lib/tabela.ts (nao um numero novo).
  it('recusa valor acima do teto do integer, nomeando o campo', () => {
    const r = analisarClientes(
      tabela(
        ['nome', 'cpf', 'limite', 'saldo'],
        [
          ['A', '11144477735', '21474836,48', '100,00'],
          ['B', '22255588846', '100,00', '21474836,48'],
          // A linha real do catalogo legado: R$ 7,9 bilhoes.
          ['C', '33366699957', '100,00', '7896714283,00'],
        ],
      ),
    )

    expect(r.linhas[0].erros).toContain(
      'Limite de crédito acima do máximo que o sistema aceita (R$ 21.474.836,47).',
    )
    for (const i of [1, 2]) {
      expect(r.linhas[i].erros).toContain(
        'Saldo devedor acima do máximo que o sistema aceita (R$ 21.474.836,47).',
      )
    }
    expect(JSON.parse(r.json)).toHaveLength(0)
    // NAO ZERA: a divida absurda continua na soma LIDA — zerar sumiria com ela.
    expect(r.linhas[1].saldo).toBe(LIMITE_DE_CENTAVOS + 1)
    expect(r.linhas[2].saldo).toBe(789671428300)
    expect(r.somaLida).toBe(10000 + (LIMITE_DE_CENTAVOS + 1) + 789671428300)
    expect(r.somaGravada).toBe(0)
  })

  it('aceita exatamente o teto do integer (é o limite do banco, não um a menos)', () => {
    const r = analisarClientes(
      tabela(['nome', 'cpf', 'limite', 'saldo'], [['A', '11144477735', '21474836,47', '21474836,47']]),
    )

    expect(r.linhas[0].erros).toEqual([])
    expect(r.linhas[0].limite_credito).toBe(LIMITE_DE_CENTAVOS)
    expect(r.linhas[0].saldo).toBe(LIMITE_DE_CENTAVOS)
  })

  // Minor da revisao: "valor invalido" e "nao pode ser negativo" sao dois fatos
  // diferentes (a mesma distincao que `clientes/validacao.ts` faz com
  // `parsearComSinal`).
  it('separa valor negativo de valor ilegível', () => {
    const r = analisarClientes(
      tabela(
        ['nome', 'cpf', 'limite', 'saldo'],
        [
          ['A', '11144477735', '-10,00', '-50,00'],
          ['B', '22255588846', 'abc', 'abc'],
        ],
      ),
    )

    expect(r.linhas[0].erros).toEqual([
      'O limite de crédito não pode ser negativo.',
      'O saldo devedor não pode ser negativo.',
    ])
    expect(r.linhas[1].erros).toEqual([
      'Limite de crédito inválido. Digite em reais, como 100,00.',
      'Saldo devedor inválido. Digite em reais, como 50,00.',
    ])
  })

  // Minor da revisao: sem a coluna de saldo, o arquivo importa clientes e nao
  // lanca divida nenhuma — numa importacao que existe para trazer os saldos, isso
  // nao pode passar em silencio (e nao e erro: cadastrar a lista e uso legitimo).
  it('avisa quando a planilha não trouxe a coluna de saldo', () => {
    const semSaldo = analisarClientes(tabela(['nome', 'cpf'], [['A', '11144477735']]))
    expect(semSaldo.avisos).toEqual([
      'Esta planilha não trouxe a coluna de saldo devedor: nenhum saldo será lançado — o arquivo só cadastra e atualiza clientes.',
    ])
    expect(semSaldo.faltando).toEqual([])
    expect(semSaldo.linhas[0].saldo).toBe(0)

    expect(analisarClientes(tabela(['nome', 'cpf', 'saldo'], [['A', '11144477735', '']])).avisos).toEqual(
      [],
    )
  })
})

// O caminho COMPLETO: o .xlsx de verdade (openpyxl) -> lerXlsx -> analisarClientes.
// E a prova de que a fixture da Task 6 e o que o plano descreve.
describe('fixture clientes.xlsx', () => {
  it('lê os 4 clientes, recusa o CPF repetido e o sem CPF, e confere o TOTAL', () => {
    const r = analisarClientes(tabelaDaFixture('clientes.xlsx'))

    expect(r.faltando).toEqual([])
    expect(r.linhas).toHaveLength(4)
    // MARIA (a primeira com o CPF) e ANTONIO sao os validos.
    expect(r.linhas.filter((l) => l.erros.length === 0).map((l) => l.nome)).toEqual([
      'MARIA DA SILVA',
      'ANTONIO COSTA',
    ])
    // O acento sobreviveu ao XML do .xlsx (o leitor decodifica em UTF-8).
    expect(r.linhas[1].nome).toBe('JOSÉ PEREIRA')
    expect(r.semCpf).toBe(1)
    expect(r.linhas[3].erros).toContain('Informe o CPF do cliente.')
    expect(r.linhas[1].erros).toEqual(['O CPF 11144477735 aparece mais de uma vez na planilha.'])
    // O telefone de ANTONIO veio com o 55 do pais.
    expect(r.linhas[2].telefone).toBe('11912345678')
    expect(r.linhas[2].limite_credito).toBe(0)
    // TOTAL impresso = soma de TUDO o que o arquivo trouxe (as 4 linhas).
    expect(r.totalImpresso).toBe(27890)
    expect(r.somaLida).toBe(27890)
    expect(r.somaGravada).toBe(13345)
    expect(JSON.parse(r.json)).toHaveLength(2)
  })
})
