import fs from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  detectarFormato,
  normalizarCabecalho,
  indiceDasColunas,
  ehRodape,
  analisarTabela,
} from './tabela'
import { lerXlsx } from './xlsx'

// Este modulo e o funil: CSV e XLSX desembocam na mesma Tabela e daqui para a
// frente existe UM caminho so. O que ele protege:
//   - cabecalho de exportador varia ("Codigo de Barras", "Cod. Barras", "EAN");
//   - planilha de sistema termina com uma linha TOTAL, que nao e produto;
//   - "nao veio a coluna de estoque" e DIFERENTE de "veio estoque 0" — e isso
//     que faz a reimportacao nao zerar o estoque de quem ja esta cadastrado.

describe('normalizarCabecalho', () => {
  it('tira acento, caixa, underscore e espacos das pontas', () => {
    expect(normalizarCabecalho('  Descrição_ ')).toBe('descricao')
    expect(normalizarCabecalho('VL VENDA')).toBe('vl venda')
  })
})

describe('indiceDasColunas', () => {
  it('mapeia apelidos de cabecalho sem acento e com espacos', () => {
    const { mapa } = indiceDasColunas(['Codigo de Barras', 'Descrição', 'VL VENDA', 'Qtde'])
    expect(mapa.codigo_barras).toBe(0)
    expect(mapa.nome).toBe(1)
    expect(mapa.preco_venda).toBe(2)
    expect(mapa.estoque_atual).toBe(3)
  })
  it('aponta o campo obrigatorio que falta', () => {
    expect(indiceDasColunas(['codigo', 'preco']).faltando).toEqual(['nome'])
  })
  it('nao reclama quando o obrigatorio existe', () => {
    expect(indiceDasColunas(['nome', 'preco']).faltando).toEqual([])
  })
})

describe('ehRodape', () => {
  it('reconhece rodape de total', () => {
    expect(ehRodape(['TOTAL', '', '', '', '1234.56'])).toBe(true)
    expect(ehRodape(['Total geral', '', ''])).toBe(true)
    expect(ehRodape(['DIPIRONA', '', '4,50'])).toBe(false)
  })
  it('produto com TOTAL no nome e categoria nao e rodape', () => {
    expect(ehRodape(['TOTAL DIPIRONA', 'Analgésico', '4,50'])).toBe(false)
  })
})

describe('detectarFormato', () => {
  it('detecta formato por assinatura', () => {
    expect(detectarFormato('x.xlsx', new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('xlsx')
    expect(detectarFormato('x.csv', new TextEncoder().encode('nome;preco'))).toBe('csv')
    expect(detectarFormato('x.xlsx', new TextEncoder().encode('nome;preco'))).toBe('desconhecido')
  })
  it('a assinatura vence a extensao', () => {
    // Arquivo com conteudo de planilha e nome .txt: o conteudo manda.
    expect(detectarFormato('x.txt', new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('xlsx')
  })
})

describe('analisarTabela', () => {
  it('le preco numerico e preco em texto com o mesmo resultado', () => {
    const a = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['DIPIRONA', '4.5']] })
    const b = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['DIPIRONA', '4,50']] })
    expect(a.linhas[0].preco_venda).toBe(450)
    expect(b.linhas[0].preco_venda).toBe(450)
  })
  it('descarta o rodape em vez de contar como linha invalida', () => {
    const r = analisarTabela({
      colunas: ['nome', 'preco'],
      linhas: [['DIPIRONA', '4,50'], ['TOTAL', '4,50']],
    })
    expect(r.validas).toBe(1)
    expect(r.descartadas).toBe(1)
    expect(r.invalidas).toBe(0)
  })
  it('nome vazio vira linha invalida nomeada', () => {
    const r = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['', '4,50']] })
    expect(r.invalidas).toBe(1)
    expect(r.linhas[0].erros[0]).toContain('nome')
  })
  it('preco ilegivel vira linha invalida, nao zero', () => {
    const r = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['DIPIRONA', '4,5O']] })
    expect(r.invalidas).toBe(1)
    expect(r.linhas[0].preco_venda).toBe(0)
  })
  it('codigo vazio vira null', () => {
    const r = analisarTabela({ colunas: ['nome', 'codigo'], linhas: [['DIPIRONA', '']] })
    expect(r.linhas[0].codigo_barras).toBeNull()
  })
  it('preserva zeros a esquerda do codigo', () => {
    const r = analisarTabela({ colunas: ['nome', 'codigo'], linhas: [['DIPIRONA', '0012345']] })
    expect(r.linhas[0].codigo_barras).toBe('0012345')
    expect(r.avisos).toEqual([])
  })
  it('avisa quando o codigo chegou sem zeros a esquerda', () => {
    const r = analisarTabela({ colunas: ['nome', 'codigo'], linhas: [['DIPIRONA', '12345']] })
    expect(r.avisos.join(' ')).toContain('zeros')
  })

  // O aviso existe para o Excel que come o zero de um codigo CURTO. Um EAN-13/14
  // completo nao perdeu zero nenhum, e o catalogo real do sistema antigo tem
  // 5613 EANs que comecam com 7 ou 8 — todos acusados em falso antes do teto.
  it('NAO avisa de zeros a esquerda para EAN de 13 ou 14 digitos', () => {
    const r = analisarTabela({
      colunas: ['nome', 'codigo'],
      linhas: [
        ['A', '7891317026370'],
        ['B', '7500435154260'],
      ],
    })
    expect(r.avisos).toEqual([])
  })

  it('EAN de 12 digitos (que pode ter perdido um zero) ainda avisa', () => {
    const r = analisarTabela({ colunas: ['nome', 'codigo'], linhas: [['A', '789131702637']] })
    expect(r.avisos.join(' ')).toContain('zeros')
  })
  // A conferencia da spec 8.7 so existe se os dois lados forem INDEPENDENTES: um
  // e a soma das linhas que o NOSSO leitor extraiu, o outro e o TOTAL que o
  // sistema antigo IMPRIMIU no rodape do arquivo. Enquanto os dois lados saiam da
  // mesma variavel, esta conferencia era uma identidade e nunca acusava nada.
  it('acusa divergencia entre a soma das linhas e o TOTAL impresso no arquivo', () => {
    const r = analisarTabela({
      colunas: ['nome', 'preco'],
      linhas: [['A', '4,50'], ['B', '5,50'], ['TOTAL', '12,00']],
    })
    expect(r.totalImpresso).toBe(1200)
    expect(r.somaGravada).toBe(1000)
    expect(r.somaConferida).toBe(false)
  })
  it('marca a soma como conferida quando o TOTAL impresso bate com as linhas', () => {
    const r = analisarTabela({
      colunas: ['nome', 'preco'],
      linhas: [['A', '4,50'], ['B', '5,50'], ['TOTAL', '10,00']],
    })
    expect(r.totalImpresso).toBe(1000)
    expect(r.somaGravada).toBe(1000)
    expect(r.somaConferida).toBe(true)
  })
  it('sem linha de TOTAL nao afirma que conferiu', () => {
    const r = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['A', '4,50']] })
    expect(r.totalImpresso).toBeNull()
    expect(r.somaConferida).toBe(false)
  })
  it('o TOTAL impresso e lido do arquivo, nao recalculado das linhas', () => {
    // Se o TOTAL saisse da soma das linhas, este caso daria 2739 e "conferiria".
    const r = analisarTabela({
      colunas: ['nome', 'preco'],
      linhas: [['A', '4,50'], ['B', '5,50'], ['TOTAL', '21,39']],
    })
    expect(r.totalImpresso).toBe(2139)
  })
  it('rodape ambiguo, sem coluna de preco reconhecida, devolve null em vez de escolher', () => {
    // Duas celulas de dinheiro e nenhuma coluna que o mapa reconheca como preco:
    // melhor nao conferir do que conferir contra o numero errado.
    const r = analisarTabela({
      colunas: ['nome', 'coluna_a', 'coluna_b'],
      linhas: [['A', '2', '4,50'], ['TOTAL', '2', '4,50']],
    })
    expect(r.totalImpresso).toBeNull()
  })
  it('sem coluna de preco reconhecida, o unico valor do rodape serve de total', () => {
    const r = analisarTabela({
      colunas: ['nome', 'coluna_a'],
      linhas: [['A', '4,50'], ['TOTAL', '4,50']],
    })
    expect(r.totalImpresso).toBe(450)
  })
  it('estoque 0 e VALOR, e nao ausencia de coluna', () => {
    const r = analisarTabela({ colunas: ['nome', 'estoque'], linhas: [['A', '0']] })
    expect(r.linhas[0].estoque_atual).toBe(0)
    expect(r.linhas[0].erros).toEqual([])
    expect(r.invalidas).toBe(0)
  })
  it('coluna de estoque ausente vira null (nao mexe no estoque de quem existe)', () => {
    const r = analisarTabela({ colunas: ['nome'], linhas: [['A']] })
    expect(r.linhas[0].estoque_atual).toBeNull()
  })
  it('estoque com texto ilegivel vira null sem invalidar a linha', () => {
    const r = analisarTabela({ colunas: ['nome', 'estoque'], linhas: [['A', 'dez']] })
    expect(r.linhas[0].estoque_atual).toBeNull()
    expect(r.invalidas).toBe(0)
  })
  it('estoque minimo vazio vira 0', () => {
    const r = analisarTabela({ colunas: ['nome', 'minimo'], linhas: [['A', '']] })
    expect(r.linhas[0].estoque_minimo).toBe(0)
  })
  it('unidade vazia vira un e categoria vazia vira null', () => {
    const r = analisarTabela({ colunas: ['nome', 'unidade', 'categoria'], linhas: [['A', '', '']] })
    expect(r.linhas[0].unidade).toBe('un')
    expect(r.linhas[0].categoria).toBeNull()
  })
  it('aponta o campo obrigatorio que falta e nao valida linha nenhuma', () => {
    const r = analisarTabela({ colunas: ['codigo', 'preco'], linhas: [['1', '4,50']] })
    expect(r.faltando).toEqual(['nome'])
    expect(r.validas).toBe(0)
  })

  // A RPC importar_produtos RECUSA o arquivo inteiro quando o mesmo codigo de
  // barras aparece duas vezes (caso 11 de 070_importacao.sql), porque a segunda
  // linha sobrescreveria a primeira em silencio. O catalogo real do sistema
  // antigo TEM esses repetidos. Decisao do Lucas: importar so o PRIMEIRO cadastro
  // de cada codigo e listar o que ficou de fora.
  it('aponta os codigos repetidos e importa so o primeiro cadastro', () => {
    const r = analisarTabela({
      colunas: ['nome', 'codigo', 'preco'],
      linhas: [
        ['A', '789', '4,50'],
        ['B', '789', '5,50'],
        ['C', '123', '1,00'],
      ],
    })
    expect(r.codigosRepetidos).toEqual(['789'])
    expect(r.ignoradasPorRepeticao).toBe(1)
    // A linha B (segundo cadastro do mesmo EAN) nao chega a RPC.
    expect(r.linhas.map((l) => l.nome)).toEqual(['A', 'C'])
    expect(r.validas).toBe(2)
  })

  // Sao DUAS somas, e elas respondem perguntas diferentes: `somaLida` e o que o
  // arquivo trouxe (e com ela que o TOTAL impresso se compara), `somaGravada` e o
  // que a RPC vai receber de fato. Somar as linhas descartadas na segunda fazia a
  // previa prometer R$ 1.452,55 a mais do que o banco gravava.
  it('a soma GRAVADA nao conta as linhas descartadas por codigo repetido', () => {
    const r = analisarTabela({
      colunas: ['nome', 'codigo', 'preco'],
      linhas: [
        ['A', '789', '4,50'],
        ['B', '789', '5,50'],
      ],
    })
    expect(r.somaLida).toBe(1000)
    expect(r.somaGravada).toBe(450)
  })

  it('a conferencia do TOTAL impresso usa a soma LIDA, nao a gravada', () => {
    // O sistema antigo somou as DUAS linhas dele no rodape (4,50 + 5,50 = 10,00),
    // mesmo repetindo o codigo: a conferencia tem que bater com o que ele imprimiu.
    const r = analisarTabela({
      colunas: ['nome', 'codigo', 'preco'],
      linhas: [
        ['A', '789', '4,50'],
        ['B', '789', '5,50'],
        ['TOTAL', '', '10,00'],
      ],
    })
    expect(r.totalImpresso).toBe(1000)
    expect(r.somaLida).toBe(1000)
    expect(r.somaConferida).toBe(true)
    // E o que sera gravado e so a primeira linha.
    expect(r.somaGravada).toBe(450)
  })

  it('codigo repetido em linha INVALIDA nao conta (ela nao vai ser gravada)', () => {
    const r = analisarTabela({
      colunas: ['nome', 'codigo', 'preco'],
      linhas: [
        ['A', '789', '4,50'],
        ['', '789', '5,50'],
      ],
    })
    expect(r.codigosRepetidos).toEqual([])
    expect(r.ignoradasPorRepeticao).toBe(0)
  })

  it('sem codigo de barras nao ha repetido (linha sem codigo sempre cria)', () => {
    const r = analisarTabela({
      colunas: ['nome', 'codigo', 'preco'],
      linhas: [
        ['A', '', '4,50'],
        ['B', '', '5,50'],
      ],
    })
    expect(r.codigosRepetidos).toEqual([])
    expect(r.linhas).toHaveLength(2)
  })

  // O exportador do sistema antigo imprime o null do banco como a palavra "null".
  // Sao 524 produtos do catalogo real: tratar isso como preco ilegivel recusava 9%
  // do catalogo por um dado que o sistema antigo nunca teve.
  it('a palavra "null" no custo e "nao sei o custo", e nao linha invalida', () => {
    const r = analisarTabela({
      colunas: ['nome', 'preco', 'custo'],
      linhas: [
        ['A', '4,50', 'null'],
        ['B', '5,50', ''],
        ['C', '6,50', '2.50'],
      ],
    })
    expect(r.invalidas).toBe(0)
    expect(r.linhas[0].preco_custo).toBeNull()
    expect(r.linhas[1].preco_custo).toBeNull()
    expect(r.linhas[2].preco_custo).toBe(250)
  })

  it('custo ilegivel de verdade continua sendo erro', () => {
    const r = analisarTabela({ colunas: ['nome', 'preco', 'custo'], linhas: [['A', '4,50', 'dois reais']] })
    expect(r.invalidas).toBe(1)
    expect(r.linhas[0].erros[0]).toContain('custo')
  })

  // O catalogo REAL do sistema antigo tem uma linha com preco R$ 7.896.714.283,00.
  // Em centavos isso estoura o `integer` do Postgres, e como a importacao e tudo
  // ou nada, essa unica linha derrubava o catalogo INTEIRO com um erro cru
  // ("value ... is out of range for type integer"). A linha tem que virar invalida
  // aqui, com aviso em portugues, para o resto entrar.
  it('preco acima do limite do integer do banco vira linha invalida, e nao estouro', () => {
    const r = analisarTabela({
      colunas: ['nome', 'preco'],
      linhas: [
        ['A', '7.896.714.283,00'],
        ['B', '4,50'],
      ],
    })
    expect(r.invalidas).toBe(1)
    expect(r.linhas[0].erros.join(' ')).toContain('limite')
    // E o resto do catalogo continua importavel.
    expect(r.validas).toBe(1)
  })

  it('custo acima do limite do banco tambem vira linha invalida', () => {
    const r = analisarTabela({
      colunas: ['nome', 'preco', 'custo'],
      linhas: [['A', '4,50', '7.896.714.283,00']],
    })
    expect(r.invalidas).toBe(1)
    expect(r.linhas[0].erros.join(' ')).toContain('limite')
  })

  it('o limite exato do integer ainda passa', () => {
    const r = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['A', '21.474.836,47']] })
    expect(r.invalidas).toBe(0)
    expect(r.linhas[0].preco_venda).toBe(2147483647)
  })

  // Cadastro INVERTIDO no exportador: a coluna de nome tem o codigo de barras e a
  // de codigo tem o nome do produto. Sao 6 linhas do catalogo real. Inverter e o
  // unico jeito de o produto entrar certo — e evita a DUPLICATA que aconteceria se
  // o dono corrigisse no Nex depois, porque a reimportacao casa por codigo de barras
  // e o codigo da linha errada e um nome.
  it('inverte nome e codigo quando o exportador trocou os dois campos', () => {
    const r = analisarTabela({
      colunas: ['nome', 'codigo', 'preco'],
      linhas: [['7895296383011', 'QUETIAPINA 25MG C30', '29,99']],
    })
    expect(r.invertidasCorrigidas).toBe(1)
    expect(r.linhas[0].nome).toBe('QUETIAPINA 25MG C30')
    expect(r.linhas[0].codigo_barras).toBe('7895296383011')
    expect(r.invalidas).toBe(0)
  })

  it('tira o apostrofo do codigo que veio como texto do Excel', () => {
    const r = analisarTabela({
      colunas: ['nome', 'codigo', 'preco'],
      linhas: [["'7896512911865", 'GLICERINA GRANADO', '7,00']],
    })
    expect(r.invertidasCorrigidas).toBe(1)
    expect(r.linhas[0].nome).toBe('GLICERINA GRANADO')
    expect(r.linhas[0].codigo_barras).toBe('7896512911865')
  })

  it('NAO inverte quando os dois lados sao codigos (nao ha nome para recuperar)', () => {
    const r = analisarTabela({
      colunas: ['nome', 'codigo', 'preco'],
      linhas: [['14792184791287 41', '7898556850209', '4,00']],
    })
    expect(r.invertidasCorrigidas).toBe(0)
    expect(r.linhas[0].nome).toBe('14792184791287 41')
  })

  it('NAO inverte cadastro normal (nome e nome, codigo e codigo)', () => {
    const r = analisarTabela({
      colunas: ['nome', 'codigo', 'preco'],
      linhas: [['DIPIRONA 500mg', '7891317026370', '4,50']],
    })
    expect(r.invertidasCorrigidas).toBe(0)
    expect(r.linhas[0].nome).toBe('DIPIRONA 500mg')
  })

  it('NAO inverte quando o codigo e um codigo de fornecedor com letras', () => {
    // "000127-WP" tem letras, mas o nome esta no lugar certo.
    const r = analisarTabela({
      colunas: ['nome', 'codigo', 'preco'],
      linhas: [['GLIBENCLAMIDA 5MG C30', '000127-WP', '6,78']],
    })
    expect(r.invertidasCorrigidas).toBe(0)
    expect(r.linhas[0].nome).toBe('GLIBENCLAMIDA 5MG C30')
  })
})

describe('analisarTabela com o arquivo do exportador', () => {
  // A fixture tem rodape TOTAL ("21,39") e tres produtos (4,50 + 6,90 + 9,99).
  // Aqui a conferencia da spec 8.7 roda de ponta a ponta no formato real, nao numa
  // Tabela montada a mao.
  function tabelaDe(nome: string) {
    return lerXlsx(new Uint8Array(fs.readFileSync(new URL(`../tests/fixtures/${nome}`, import.meta.url))))
  }

  it('confere a soma das linhas contra o TOTAL impresso no arquivo', () => {
    const r = analisarTabela(tabelaDe('produtos_texto.xlsx'))
    expect(r.totalImpresso).toBe(2139)
    expect(r.somaGravada).toBe(2139)
    expect(r.somaConferida).toBe(true)
  })

  it('sem linha de TOTAL no arquivo, nao afirma que conferiu', () => {
    const r = analisarTabela(tabelaDe('produtos.xlsx'))
    expect(r.totalImpresso).toBeNull()
    expect(r.somaConferida).toBe(false)
  })
})
