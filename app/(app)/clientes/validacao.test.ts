import { describe, it, expect } from 'vitest'
import { validarCliente, validarRecebimento, formatarTelefone, linkWhatsApp } from './validacao'

// O cadastro de cliente e o recebimento dependem de RPCs que ja existem e estao
// testadas (014_receber_pagamento.sql e 015_clientes.sql). O que estes testes
// cobrem e o que a TELA recusa antes de chamar o banco — e, principalmente, que a
// tela diga a MESMA coisa que o banco. Repetir o texto do Postgres aqui e o ponto:
// se a grafia divergir, o operador le uma mensagem no balcao e outra no log.

const vazio = { nome: '', telefone: '', cpf: '', limite: '', saldoInicial: '' }

describe('validarCliente', () => {
  it('nome vazio ou so espacos e recusado com a mensagem da RPC', () => {
    expect(validarCliente({ ...vazio, nome: '  ' }, true)).toEqual({
      ok: false,
      mensagem: 'Escreva o nome do cliente.',
    })
    expect(validarCliente({ ...vazio, nome: '' }, true)).toEqual({
      ok: false,
      mensagem: 'Escreva o nome do cliente.',
    })
  })

  it('o limite le reais de verdade: "10.00" e DEZ REAIS, nao mil', () => {
    // O erro de fator 100 ja apareceu duas vezes neste projeto (spec 11 B3). Se
    // este teste virar 100000, o cliente ganha 100x o credito que o dono liberou.
    expect(validarCliente({ ...vazio, nome: 'ANA', limite: '10.00' }, true)).toEqual({
      ok: true,
      valores: { nome: 'ANA', telefone: null, cpf: null, limite: 1000, saldoInicial: 0 },
    })
    expect(validarCliente({ ...vazio, nome: 'ANA', limite: '1.234,56' }, true)).toEqual({
      ok: true,
      valores: { nome: 'ANA', telefone: null, cpf: null, limite: 123456, saldoInicial: 0 },
    })
  })

  it('limite negativo e recusado com a mensagem da RPC', () => {
    expect(validarCliente({ ...vazio, nome: 'ANA', limite: '-5' }, true)).toEqual({
      ok: false,
      mensagem: 'O limite de crédito não pode ser negativo.',
    })
  })

  it('limite ilegivel vira mensagem em portugues, nao Number cru', () => {
    expect(validarCliente({ ...vazio, nome: 'ANA', limite: 'abc' }, true).ok).toBe(false)
    expect(validarCliente({ ...vazio, nome: 'ANA', limite: 'abc' }, true)).toEqual({
      ok: false,
      mensagem: 'Limite de crédito inválido. Digite em reais, como 100,00.',
    })
  })

  it('limite vazio e zero: "nao faz crediario", nao ilimitado (spec 8.4)', () => {
    expect(validarCliente({ ...vazio, nome: 'ANA' }, true)).toEqual({
      ok: true,
      valores: { nome: 'ANA', telefone: null, cpf: null, limite: 0, saldoInicial: 0 },
    })
  })

  it('atendente nao lanca saldo inicial — e a mensagem da RPC', () => {
    expect(validarCliente({ ...vazio, nome: 'ANA', saldoInicial: '50' }, false)).toEqual({
      ok: false,
      mensagem: 'Só o dono pode lançar saldo devedor.',
    })
  })

  it('saldo inicial negativo e recusado antes da guarda de papel', () => {
    expect(validarCliente({ ...vazio, nome: 'ANA', saldoInicial: '-1' }, true)).toEqual({
      ok: false,
      mensagem: 'O saldo inicial não pode ser negativo.',
    })
    expect(validarCliente({ ...vazio, nome: 'ANA', saldoInicial: '-1' }, false)).toEqual({
      ok: false,
      mensagem: 'O saldo inicial não pode ser negativo.',
    })
  })

  it('saldo inicial ilegivel vira mensagem em portugues', () => {
    expect(validarCliente({ ...vazio, nome: 'ANA', saldoInicial: '50,0,0' }, true)).toEqual({
      ok: false,
      mensagem: 'Saldo inicial inválido. Digite em reais, como 50,00.',
    })
  })

  it('o dono lanca o saldo inicial em centavos', () => {
    expect(validarCliente({ ...vazio, nome: 'ANA', saldoInicial: '50' }, true)).toEqual({
      ok: true,
      valores: { nome: 'ANA', telefone: null, cpf: null, limite: 0, saldoInicial: 5000 },
    })
  })

  it('atendente com saldo vazio ou zero passa: e edicao normal de nome e telefone', () => {
    expect(validarCliente({ ...vazio, nome: 'ANA', saldoInicial: '' }, false).ok).toBe(true)
    expect(validarCliente({ ...vazio, nome: 'ANA', saldoInicial: '0' }, false).ok).toBe(true)
  })

  it('CPF: 11 digitos ou vazio, e o que fica gravado e digito puro', () => {
    expect(validarCliente({ ...vazio, nome: 'ANA', cpf: '123' }, true)).toEqual({
      ok: false,
      mensagem: 'CPF inválido. Use 11 dígitos.',
    })
    expect(validarCliente({ ...vazio, nome: 'ANA', cpf: '123.456.789-01' }, true)).toEqual({
      ok: true,
      valores: { nome: 'ANA', telefone: null, cpf: '12345678901', limite: 0, saldoInicial: 0 },
    })
    expect(validarCliente({ ...vazio, nome: 'ANA', cpf: '   ' }, true)).toEqual({
      ok: true,
      valores: { nome: 'ANA', telefone: null, cpf: null, limite: 0, saldoInicial: 0 },
    })
  })

  it('telefone: 10 ou 11 digitos, normalizado para digito puro', () => {
    expect(validarCliente({ ...vazio, nome: 'ANA', telefone: '(11) 91234-5678' }, true)).toEqual({
      ok: true,
      valores: { nome: 'ANA', telefone: '11912345678', cpf: null, limite: 0, saldoInicial: 0 },
    })
    expect(validarCliente({ ...vazio, nome: 'ANA', telefone: '(11) 3212-3456' }, true)).toEqual({
      ok: true,
      valores: { nome: 'ANA', telefone: '1132123456', cpf: null, limite: 0, saldoInicial: 0 },
    })
    expect(validarCliente({ ...vazio, nome: 'ANA', telefone: '123' }, true)).toEqual({
      ok: false,
      mensagem: 'Telefone inválido. Use DDD + número, como 11 91234-5678.',
    })
    // " " nao pode virar chave nem virar telefone vazio gravado.
    expect(validarCliente({ ...vazio, nome: 'ANA', telefone: ' ' }, true)).toEqual({
      ok: true,
      valores: { nome: 'ANA', telefone: null, cpf: null, limite: 0, saldoInicial: 0 },
    })
  })
})

describe('validarRecebimento', () => {
  it('valor ilegivel vira mensagem, nunca erro de banco', () => {
    expect(validarRecebimento('abc', 5000)).toEqual({
      ok: false,
      mensagem: 'Valor inválido. Use, por exemplo, 20,00.',
    })
    expect(validarRecebimento('', 5000)).toEqual({
      ok: false,
      mensagem: 'Valor inválido. Use, por exemplo, 20,00.',
    })
    expect(validarRecebimento('20,0,0', 5000)).toEqual({
      ok: false,
      mensagem: 'Valor inválido. Use, por exemplo, 20,00.',
    })
  })

  it('valor zero ou negativo e recusado com a mensagem da RPC', () => {
    expect(validarRecebimento('0', 5000)).toEqual({
      ok: false,
      mensagem: 'O valor do recebimento precisa ser maior que zero.',
    })
    expect(validarRecebimento('-10', 5000)).toEqual({
      ok: false,
      mensagem: 'O valor do recebimento precisa ser maior que zero.',
    })
  })

  it('valor acima da divida usa a MESMA mensagem e a MESMA formatacao da RPC', () => {
    expect(validarRecebimento('60,00', 5000)).toEqual({
      ok: false,
      mensagem: 'O valor é maior que a dívida (R$ 50,00).',
    })
    expect(validarRecebimento('2000', 123456)).toEqual({
      ok: false,
      mensagem: 'O valor é maior que a dívida (R$ 1.234,56).',
    })
  })

  it('divida ja zerada nao vira credito: um centavo e recusado', () => {
    expect(validarRecebimento('0,01', 0)).toEqual({
      ok: false,
      mensagem: 'O valor é maior que a dívida (R$ 0,00).',
    })
  })

  it('pagamento parcial e pagamento exato passam', () => {
    expect(validarRecebimento('20,00', 5000)).toEqual({ ok: true, centavos: 2000 })
    expect(validarRecebimento('50,00', 5000)).toEqual({ ok: true, centavos: 5000 })
    // Um digito depois do ponto e decimo, nao centavo nem milhar: "1.5" = R$ 1,50.
    expect(validarRecebimento('1.5', 5000)).toEqual({ ok: true, centavos: 150 })
  })

  it('o ponto decimal nao e milhar: "10.00" e DEZ REAIS', () => {
    // Review Focus 5: se virar 100000, o recebimento e recusado por "maior que a
    // divida" mesmo cabendo, ou abate 100x o que o cliente pagou.
    expect(validarRecebimento('10.00', 5000)).toEqual({ ok: true, centavos: 1000 })
    expect(validarRecebimento('1.234,56', 200000)).toEqual({ ok: true, centavos: 123456 })
  })
})

describe('formatarTelefone', () => {
  it('celular de 11 digitos ganha parenteses e hifen', () => {
    expect(formatarTelefone('11912345678')).toBe('(11) 91234-5678')
  })

  it('fixo de 10 digitos tambem', () => {
    expect(formatarTelefone('1132123456')).toBe('(11) 3212-3456')
  })

  it('aceita o telefone ja pontuado', () => {
    expect(formatarTelefone('(11) 91234-5678')).toBe('(11) 91234-5678')
  })

  it('vazio ou quantidade errada de digitos e null, nao texto quebrado', () => {
    expect(formatarTelefone('')).toBeNull()
    expect(formatarTelefone('   ')).toBeNull()
    expect(formatarTelefone('123')).toBeNull()
    expect(formatarTelefone('119123456789')).toBeNull()
  })
})

describe('linkWhatsApp', () => {
  it('sem telefone nao ha link', () => {
    expect(linkWhatsApp(null, 'ANA', 5000)).toBeNull()
    expect(linkWhatsApp('', 'ANA', 5000)).toBeNull()
    // Telefone sem nenhum digito nao vira "wa.me/55".
    expect(linkWhatsApp('sem telefone', 'ANA', 5000)).toBeNull()
  })

  it('monta o wa.me com a mensagem pronta e codificada', () => {
    expect(linkWhatsApp('11912345678', 'ANA', 5000)).toBe(
      'https://wa.me/5511912345678?text=' +
        encodeURIComponent('Olá, ANA! Seu saldo na farmácia é R$ 50,00. Podemos acertar?'),
    )
  })

  it('a mensagem leva o saldo formatado em reais, inclusive saldo credor anomalo', () => {
    expect(linkWhatsApp('11912345678', 'ANA', 123456)).toBe(
      'https://wa.me/5511912345678?text=' +
        encodeURIComponent('Olá, ANA! Seu saldo na farmácia é R$ 1.234,56. Podemos acertar?'),
    )
    // Saldo credor e anomalia (o estorno do cancelamento pode deixar um gravado),
    // mas a cobranca nao pode virar "R$ NaN" nem perder o sinal: o numero sai
    // formatado como qualquer outro. O sinal fica antes do "R$" (Intl).
    expect(linkWhatsApp('11912345678', 'ANA', -2000)).toBe(
      'https://wa.me/5511912345678?text=' +
        encodeURIComponent('Olá, ANA! Seu saldo na farmácia é -R$ 20,00. Podemos acertar?'),
    )
  })

  it('nome com espacos em volta e aparado; sem nome, a saudacao nao fica com virgula solta', () => {
    expect(linkWhatsApp('11912345678', '  ANA  ', 5000)).toBe(
      'https://wa.me/5511912345678?text=' +
        encodeURIComponent('Olá, ANA! Seu saldo na farmácia é R$ 50,00. Podemos acertar?'),
    )
    expect(linkWhatsApp('11912345678', '   ', 5000)).toBe(
      'https://wa.me/5511912345678?text=' +
        encodeURIComponent('Olá! Seu saldo na farmácia é R$ 50,00. Podemos acertar?'),
    )
  })

  it('telefone ja pontuado tambem vira link (digito puro ate o wa.me)', () => {
    expect(linkWhatsApp('(11) 91234-5678', 'ANA', 5000)).toBe(
      'https://wa.me/5511912345678?text=' +
        encodeURIComponent('Olá, ANA! Seu saldo na farmácia é R$ 50,00. Podemos acertar?'),
    )
  })

  it('o link SO abre: nao ha nada alem de wa.me e a mensagem', () => {
    const link = linkWhatsApp('11912345678', 'ANA', 5000)
    expect(link).toContain('https://wa.me/')
    expect(link?.split('?text=')).toHaveLength(2)
  })
})
