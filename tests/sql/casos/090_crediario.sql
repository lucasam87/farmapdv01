-- 090_crediario.sql — casos de receber_pagamento (Task 1 da etapa 6).
--
-- O cenario vende R$ 100,00 no crediario e recebe em cima dessa divida. Todas as
-- assercoes sao escopadas por cliente_id/sessao_id: o banco e o de PRODUCAO e
-- contar a tabela inteira aqui mediria a farmacia, nao a funcao.
--
-- Ordem: os casos 1, 2, 3, 5, 6, 7 e 8 precisam do caixa aberto; o caso 4 precisa
-- de um caixa JÁ fechado, entao ele roda no fim, depois de fechar a sessao na mao
-- (como o caso 4 de 020_cancelamento.sql faz).

do $$
declare
  v_dono       uuid;
  v_atendente  uuid;
  v_caixa      uuid;
  v_c1         uuid;
  v_c2         uuid;
  v_p1         uuid;
  v_p2         uuid;
begin
  -- ================= cenario =================
  v_dono := criar_usuario_teste(gen_random_uuid(), 'dono@farmacia.local');
  v_atendente := criar_usuario_teste(gen_random_uuid(), 'atendente@farmacia.local', 'atendente');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);

  -- limite folgado: quem limita o recebimento aqui e a divida, nao o credito
  v_c1 := criar_cliente('JOSE DA DIVIDA', 100000, false);
  v_c2 := criar_cliente('CLIENTE QUE ZERA A DIVIDA', 100000, false);

  v_p1 := criar_produto('PRODUTO DO CREDIARIO', 10000, 10);
  v_p2 := criar_produto('PRODUTO QUE SERA PAGO', 5000, 10);

  v_caixa := criar_caixa_aberto(v_dono);

  -- A divida nasce pela RPC de venda, de proposito: quem testa o recebimento nao
  -- pode montar o cenario inserindo lancamento na mao.
  perform registrar_venda(gen_random_uuid(), v_c1,
    jsonb_build_array(jsonb_build_object('produto_id', v_p1, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'crediario', 'valor', 10000)),
    0);

  perform teste_ok((select saldo = 10000 from v_clientes_devedores where cliente_id = v_c1),
    'cenario: a venda no crediario deixou o cliente devendo R$ 100,00');

  -- ================= caso 1: baixa parcial e o saldo cai =================
  perform teste_ok(((receber_pagamento(v_c1, 2000, 'dinheiro'))->>'saldo_apos')::int = 8000,
    'caso 1: a RPC devolve o saldo depois do pagamento');
  perform teste_ok((select saldo = 8000 from v_clientes_devedores where cliente_id = v_c1),
    'caso 1: pagamento de R$ 20,00 sobre dívida de R$ 100,00 deixa saldo de R$ 80,00');

  -- ================= caso 2: acima da divida e recusado (spec 8.4: nunca gerar saldo credor) =================
  -- O trecho inclui o valor: uma mensagem que perdesse o centavos_em_reais nao
  -- passaria por engano.
  perform teste_erro(format('select receber_pagamento(%L, 900000, %L)', v_c1, 'dinheiro'),
    'O valor é maior que a dívida (R$ 80,00)',
    'caso 2: acima da divida e recusado sem gerar credito');
  perform teste_ok((select saldo = 8000 from v_clientes_devedores where cliente_id = v_c1),
    'caso 2: a recusa nao mexeu no saldo devedor');

  -- divida ja zerada: nao pode virar saldo credor (Review Focus 2).
  -- O pagamento deste cliente e em PIX de proposito: assim ele nao mexe na
  -- gaveta e o caso 3 continua medindo so o recebimento em dinheiro do caso 1.
  perform registrar_venda(gen_random_uuid(), v_c2,
    jsonb_build_array(jsonb_build_object('produto_id', v_p2, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'crediario', 'valor', 5000)),
    0);
  perform teste_ok(((receber_pagamento(v_c2, 5000, 'pix'))->>'saldo_apos')::int = 0,
    'caso 2b: o pagamento integral zera a divida do segundo cliente');
  perform teste_erro(format('select receber_pagamento(%L, 100, %L)', v_c2, 'dinheiro'),
    'O valor é maior que a dívida (R$ 0,00)',
    'caso 2b: pagar com a divida ja zerada e recusado e nao gera credito');
  perform teste_ok((select count(*) = 0 from v_clientes_devedores where cliente_id = v_c2),
    'caso 2b: o cliente quitado sai da lista de devedores');

  -- ================= caso 3: dinheiro entra no esperado da gaveta; pix NAO =================
  -- A gaveta e lida da PROPRIA sessao do cenario, pela formula da spec 8.3 e sem
  -- variavel intermediaria: `valor_inicial + so o que entrou em dinheiro`.
  -- Nao ha recebimento em dinheiro antes deste caso (o do caso 2b e em PIX de
  -- proposito), entao 2000 e o valor exato. Um segundo terminal aberto nao afeta
  -- nada aqui, e a assercao nao depende de comparacao entre variaveis.
  perform teste_ok((select valor_inicial + coalesce(sum(
                        case when tipo in ('venda', 'recebimento_crediario')
                                  and forma = 'dinheiro' then valor else 0 end), 0)
                      from caixa_sessoes s
                      left join caixa_movimentos m on m.sessao_id = s.id
                      where s.id = v_caixa
                      group by s.valor_inicial) = 2000,
    'caso 3: recebimento em dinheiro entra em esperado_dinheiro');
  perform teste_ok((select count(*) = 1 from caixa_movimentos
                    where sessao_id = v_caixa and tipo = 'recebimento_crediario'
                      and forma = 'dinheiro' and valor = 2000),
    'caso 3: o recebimento entrou como recebimento_crediario/dinheiro, nao como venda');

  perform receber_pagamento(v_c1, 1000, 'pix');
  -- O PIX tem de ficar registrado no caixa, mas sem entrar na conta do dinheiro:
  -- o mesmo calculo tem de continuar dando 2000.
  perform teste_ok((select valor_inicial + coalesce(sum(
                        case when tipo in ('venda', 'recebimento_crediario')
                                  and forma = 'dinheiro' then valor else 0 end), 0)
                      from caixa_sessoes s
                      left join caixa_movimentos m on m.sessao_id = s.id
                      where s.id = v_caixa
                      group by s.valor_inicial) = 2000,
    'caso 3: recebimento em pix NAO entra em esperado_dinheiro');
  perform teste_ok((select count(*) = 1 from caixa_movimentos
                    where sessao_id = v_caixa and tipo = 'recebimento_crediario'
                      and forma = 'pix' and valor = 1000),
    'caso 3: o recebimento em pix ficou registrado no caixa com a forma certa');

  -- ================= caso 5: valor zero ou negativo e recusado =================
  -- O trecho e o da RPC, e SO dela: 'valor' sozinho casaria com o nome do check
  -- do banco (crediario_lancamentos_valor_check) e com a mensagem do caso 2, entao
  -- o teste passaria mesmo com o guarda de valor removido da funcao.
  perform teste_erro(format('select receber_pagamento(%L, 0, %L)', v_c1, 'dinheiro'),
    'precisa ser maior que zero', 'caso 5: receber valor zero e recusado');
  perform teste_erro(format('select receber_pagamento(%L, -500, %L)', v_c1, 'dinheiro'),
    'precisa ser maior que zero', 'caso 5: receber valor negativo e recusado');
  perform teste_ok((select saldo = 7000 from v_clientes_devedores where cliente_id = v_c1),
    'caso 5: nenhuma das recusas mexeu no saldo');

  -- ================= caso 6: forma 'crediario' e recusada =================
  perform teste_erro(format('select receber_pagamento(%L, 1000, %L)', v_c1, 'crediario'),
    'Forma de recebimento', 'caso 6: crediario nao e forma de receber');

  -- ================= caso 7: atendente PODE receber (spec 5: dono, atendente) =================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
  perform teste_ok(((receber_pagamento(v_c1, 1000, 'dinheiro'))->>'saldo_apos')::int = 6000,
    'caso 7: atendente pode receber e o saldo cai para R$ 60,00');

  -- ================= caso 8: o pagamento vira uma linha em crediario_lancamentos com forma e usuario =================
  perform teste_ok((select count(*) = 1 from crediario_lancamentos
                    where cliente_id = v_c1 and tipo = 'pagamento' and valor = 1000
                      and forma_pagamento = 'dinheiro' and usuario_id = v_atendente
                      and venda_id is null),
    'caso 8: o pagamento gravou tipo, valor, forma e o usuario que recebeu');

  -- ================= cliente inexistente e recusado =================
  perform teste_erro(format('select receber_pagamento(%L, 1000, %L)', gen_random_uuid(), 'dinheiro'),
    'Cliente não encontrado', 'extra: cliente inexistente e recusado');

  -- ================= caso 4: sem caixa aberto e recusado com a mensagem da venda (spec 8.4) =================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  update caixa_sessoes set status = 'fechado' where id = v_caixa;

  perform teste_erro(format('select receber_pagamento(%L, 1000, %L)', v_c1, 'dinheiro'),
    'Abra o caixa para começar a vender.',
    'caso 4: receber sem caixa aberto e recusado com a mensagem da venda');
end $$;
