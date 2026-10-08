-- 080_historico.sql — casos de v_vendas_historico (migration 012, Etapa 5).
--
-- O que a view prova: a lista do dia precisa MOSTRAR a venda cancelada, marcada
-- com status, motivo, quem cancelou e quando — sem que isso contamine
-- v_vendas_lista (faturamento, spec secao 6) nem v_vendas_dia.
--
-- O cenario usa criado_em EXPLICITO e no passado (janeiro), para o dia de cada
-- venda ser deterministico: a suite roda contra o banco de PRODUCAO, onde
-- existe venda real da farmacia. Por isso nenhuma assercao conta a tabela
-- inteira — todas filtram por venda_id ou por um dia de janeiro isolado.
--
-- Nota de interpretacao: a venda cancelada sai por 300 (produto de 450 com
-- desconto de 150), que e o total exigido pelo caso 2.

do $$
declare
  v_dono       uuid;
  v_caixa      uuid;
  v_chave      uuid;
  v_p_noite    uuid;
  v_p_hoje     uuid;
  v_p_cancel   uuid;
  v_s_noite    uuid;
  v_s_hoje     uuid;
  v_s_cancel   uuid;
begin
  -- ================= cenario =================
  v_dono := criar_usuario_teste(gen_random_uuid(), 'historico@farmacia.local');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);

  v_caixa := criar_caixa_aberto(v_dono);

  v_p_noite := criar_produto('PRODUTO NOITE', 450, 100);
  v_p_hoje := criar_produto('PRODUTO HOJE', 500, 100);
  v_p_cancel := criar_produto('PRODUTO CANCELADO', 450, 100);

  -- v_s_noite: 2x PRODUTO NOITE (900), dinheiro 1000
  v_chave := gen_random_uuid();
  v_s_noite := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_noite, 'quantidade', 2)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000)),
    0)->>'id')::uuid;
  update vendas set criado_em = timestamptz '2026-01-16 01:00:00+00' where id = v_s_noite;  -- 22h de 15/01 em SP

  -- v_s_hoje: 1x PRODUTO HOJE (500), dinheiro 1000
  v_chave := gen_random_uuid();
  v_s_hoje := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_hoje, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000)),
    0)->>'id')::uuid;
  update vendas set criado_em = timestamptz '2026-01-16 13:00:00+00' where id = v_s_hoje;   -- 10h de 16/01 em SP

  -- v_s_cancel: 1x PRODUTO CANCELADO (300 = 450 - 150), dinheiro 1000, cancelada com o caixa aberto
  v_chave := gen_random_uuid();
  v_s_cancel := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_cancel, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000)),
    150)->>'id')::uuid;
  update vendas set criado_em = timestamptz '2026-01-17 14:00:00+00' where id = v_s_cancel;  -- 11h de 17/01 em SP
  perform cancelar_venda(v_s_cancel, 'cliente desistiu');

  -- ================= caso 1: a view nao filtra status =================
  perform teste_ok((select count(*) = 1 from v_vendas_historico where venda_id = v_s_cancel),
    'caso 1: a venda cancelada aparece em v_vendas_historico');
  perform teste_ok((select count(*) = 1 from v_vendas_historico where venda_id = v_s_hoje),
    'caso 1: a venda concluida aparece em v_vendas_historico');

  -- ================= caso 2: a cancelada vem identificada =================
  perform teste_ok((select status = 'cancelada'
                      and motivo_cancelamento = 'cliente desistiu'
                      and cancelado_por_nome = 'historico@farmacia.local'
                      and cancelado_em is not null
                      and total = 300
                      and itens = '1x PRODUTO CANCELADO'
                    from v_vendas_historico where venda_id = v_s_cancel),
    'caso 2: a cancelada vem com status, motivo, quem cancelou e o que foi vendido');

  -- ================= caso 3: o faturamento nao ve a cancelada =================
  perform teste_ok((select count(*) = 0 from v_vendas_lista where venda_id = v_s_cancel),
    'caso 3: a cancelada nao aparece em v_vendas_lista');
  perform teste_ok((select coalesce(sum(total), 0) = 0 from v_vendas_dia where dia = date '2026-01-17'),
    'caso 3: o dia da cancelada fica zerado em v_vendas_dia');

  -- ================= caso 4: o dia e o de Sao Paulo =================
  perform teste_ok((select dia = date '2026-01-15' and criado_em::time = time '22:00'
                    from v_vendas_historico where venda_id = v_s_noite),
    'caso 4: a venda das 22h de 15/01 tem dia 2026-01-15 e hora 22:00');
  perform teste_ok((select coalesce(sum(total), 0) = 900 from v_vendas_dia where dia = date '2026-01-15'),
    'caso 4: o total do dia 15/01 e o dela');

  -- ================= caso 5: dia sem venda =================
  perform teste_ok((select count(*) = 0 from v_vendas_historico where dia = date '2026-01-14'),
    'caso 5: um dia sem venda nao devolve linha');
end $$;
