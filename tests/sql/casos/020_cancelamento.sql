-- 020_cancelamento.sql — casos de cancelar_venda (matriz da spec secao 8.2).
--
-- O caso 7 do plano (venda cancelada nao aparece em v_vendas_dia) depende da
-- view da Task 11: ele mora no arquivo de teste da Task 11, onde a view existe.
--
-- Ordem: o caixa fica aberto para os casos 1, 2, 3, 5 e 6; o caso 4 precisa de um
-- caixa JÁ fechado, entao ele roda no fim, depois de fechar a sessao na mao.

do $$
declare
  v_dono       uuid;
  v_atendente  uuid;
  v_caixa      uuid;
  v_cliente1   uuid;
  v_cliente2   uuid;
  v_p1         uuid;
  v_p3         uuid;
  v_p4         uuid;
  v_p5         uuid;
  v_p6         uuid;
  v_chave      uuid;
  v_s1         uuid;
  v_s3         uuid;
  v_s4         uuid;
  v_s5         uuid;
  v_s6         uuid;
begin
  -- ================= cenario =================
  v_dono := criar_usuario_teste(gen_random_uuid(), 'dono@farmacia.local');
  v_atendente := criar_usuario_teste(gen_random_uuid(), 'atendente@farmacia.local', 'atendente');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);

  v_cliente1 := criar_cliente('MARIA PAGOU DEPOIS', 100000, false);
  v_cliente2 := criar_cliente('ANA CREDIARIO LIMPO', 100000, false);

  v_p1 := criar_produto('PRODUTO CASO 1', 450, 10);
  v_p3 := criar_produto('PRODUTO CASO 3', 450, 10);
  v_p4 := criar_produto('PRODUTO CASO 4', 450, 10);
  v_p5 := criar_produto('PRODUTO CASO 5', 4500, 10);
  v_p6 := criar_produto('PRODUTO CASO 6', 4500, 10);

  v_caixa := criar_caixa_aberto(v_dono);

  -- Venda do caso 4: nasce agora, e cancelada no fim, com o caixa ja fechado.
  v_chave := gen_random_uuid();
  v_s4 := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p4, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000)),
    0)->>'id')::uuid;

  -- ================= caso 1: cancelar com caixa aberto =================
  v_chave := gen_random_uuid();
  v_s1 := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p1, 'quantidade', 2)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 2000)),
    0)->>'id')::uuid;
  perform teste_ok((select estoque_atual = 8 from produtos where id = v_p1),
    'caso 1: a venda baixou o estoque para 8');

  perform cancelar_venda(v_s1, 'cliente desistiu');

  perform teste_ok((select estoque_atual = 10 from produtos where id = v_p1),
    'caso 1: o estoque voltou de 8 para 10');
  perform teste_ok((select status = 'cancelada' from vendas where id = v_s1),
    'caso 1: a venda ficou cancelada');
  perform teste_ok((select cancelado_por = v_dono and motivo_cancelamento = 'cliente desistiu'
                    from vendas where id = v_s1),
    'caso 1: registrou quem cancelou e o motivo');
  perform teste_ok((select count(*) = 1 from estoque_movimentos
                    where venda_id = v_s1 and tipo = 'cancelamento'
                      and quantidade = 2 and saldo_apos = 10),
    'caso 1: movimento de cancelamento com a quantidade de volta e o saldo_apos');
  perform teste_ok((select count(*) = 1 from caixa_movimentos
                    where venda_id = v_s1 and tipo = 'cancelamento'
                      and forma = 'dinheiro' and valor = -900),
    'caso 1: estorno de 900 no caixa, negativo');

  -- ================= caso 2: cancelar duas vezes =================
  perform teste_erro(
    format('select cancelar_venda(%L, %L)', v_s1, 'de novo'),
    'Esta venda já foi cancelada em',
    'caso 2: cancelar a mesma venda duas vezes e recusado');

  -- ================= caso 3: quem nao e dono nao cancela =================
  v_chave := gen_random_uuid();
  v_s3 := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p3, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000)),
    0)->>'id')::uuid;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
  perform teste_erro(
    format('select cancelar_venda(%L, %L)', v_s3, 'atendente tentando cancelar'),
    'Só o dono pode cancelar vendas.',
    'caso 3: atendente nao pode cancelar');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  perform teste_ok((select status = 'concluida' from vendas where id = v_s3),
    'caso 3: a venda continua concluida depois da tentativa');

  -- ================= caso 5: cliente pagou depois da venda =================
  v_chave := gen_random_uuid();
  v_s5 := (registrar_venda(v_chave, v_cliente1,
    jsonb_build_array(jsonb_build_object('produto_id', v_p5, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'crediario', 'valor', 4500)),
    0)->>'id')::uuid;

  -- O pagamento posterior e inserido com clock_timestamp(): dentro de uma unica
  -- transacao, now() (default de criado_em) seria igual ao da venda e o bloqueio
  -- da spec 8.2 nunca dispararia.
  insert into crediario_lancamentos (cliente_id, venda_id, tipo, valor, usuario_id, criado_em)
  values (v_cliente1, v_s5, 'pagamento', 1000, v_dono, clock_timestamp());

  perform teste_erro(
    format('select cancelar_venda(%L, %L)', v_s5, 'cancelando com pagamento posterior'),
    'já fez pagamento após esta venda',
    'caso 5: venda com pagamento posterior do cliente e bloqueada');
  perform teste_ok((select status = 'concluida' from vendas where id = v_s5),
    'caso 5: a venda continua concluida');

  -- ================= caso 6: crediario cancelado sem pagamento posterior =================
  v_chave := gen_random_uuid();
  v_s6 := (registrar_venda(v_chave, v_cliente2,
    jsonb_build_array(jsonb_build_object('produto_id', v_p6, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'crediario', 'valor', 4500)),
    0)->>'id')::uuid;
  perform teste_ok((select coalesce(sum(case when tipo = 'compra' then valor else -valor end), 0) = 4500
                    from crediario_lancamentos where cliente_id = v_cliente2),
    'caso 6: antes do cancelamento o cliente deve 4500');

  perform cancelar_venda(v_s6, 'erro de digitacao');

  perform teste_ok((select status = 'cancelada' from vendas where id = v_s6),
    'caso 6: a venda de crediario foi cancelada');
  perform teste_ok((select coalesce(sum(case when tipo = 'compra' then valor else -valor end), 0) = 0
                    from crediario_lancamentos where cliente_id = v_cliente2),
    'caso 6: o saldo do cliente volta a zero');
  perform teste_ok((select count(*) = 1 from crediario_lancamentos
                    where venda_id = v_s6 and tipo = 'pagamento'
                      and valor = 4500 and estorna_lancamento_id is not null),
    'caso 6: o estorno aponta para o lancamento de compra original');

  -- ================= caso 4: caixa da venda ja fechado =================
  update caixa_sessoes set status = 'fechado' where id = v_caixa;

  perform teste_erro(
    format('select cancelar_venda(%L, %L)', v_s4, 'tarde demais'),
    'caixa já fechado',
    'caso 4: cancelar venda de caixa fechado e bloqueado');
  perform teste_erro(
    format('select cancelar_venda(%L, %L)', v_s4, 'tarde demais'),
    'Registre um estorno no caixa de hoje',
    'caso 4: a mensagem ensina o caminho (estorno no caixa de hoje)');
  perform teste_ok((select status = 'concluida' from vendas where id = v_s4),
    'caso 4: a venda continua concluida');

  -- caso 7 (v_vendas_dia nao mostra venda cancelada) roda no arquivo da Task 11.
end $$;
