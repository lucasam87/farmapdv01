-- 040_views.sql — casos das views de leitura (spec secao 6).
--
-- Aqui rodam tambem os dois casos que dependiam das views e por isso nao
-- cabiam nos arquivos anteriores:
--   caso 18 do plano da venda  -> venda das 22h de 05/10 (SP) no dia certo (A3)
--   caso 7 do plano do cancelamento -> venda cancelada fora de v_vendas_dia e
--                                      de v_lucro_periodo (A7)
--
-- As vendas usam criado_em explicito, e nao now(), para o dia de cada uma ser
-- deterministico (o caso do fuso exige 22h de 05/10 em Sao Paulo).
--
-- Cuidado que o teste registra: now() e o inicio da TRANSACAO. Como tudo roda
-- numa transacao so, todas as vendas nasceriam com o mesmo criado_em.

do $$
declare
  v_dono            uuid;
  v_caixa           uuid;
  v_chave           uuid;
  v_s_noite         uuid;
  v_s_lucro         uuid;
  v_s_cancel        uuid;
  v_s_dividido      uuid;
  v_s_cred          uuid;
  v_s_c2            uuid;
  v_s_c3            uuid;
  v_p_noite         uuid;
  v_p_lucro         uuid;
  v_p_cancel        uuid;
  v_p_dividido      uuid;
  v_p_cred          uuid;
  v_p_c2            uuid;
  v_p_c3            uuid;
  v_p_baixo         uuid;
  v_p_zerado        uuid;
  v_p_parado        uuid;
  v_c1              uuid;
  v_c2              uuid;
  v_c3              uuid;
  v_esperado_antes  integer;
  v_esperado_depois integer;
begin
  -- ================= cenario =================
  v_dono := criar_usuario_teste(gen_random_uuid(), 'views@farmacia.local');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  v_caixa := abrir_caixa(10000);

  v_p_noite := criar_produto('PRODUTO NOITE', 450, 100);
  v_p_lucro := criar_produto('PRODUTO LUCRO', 1000, 100);
  v_p_cancel := criar_produto('PRODUTO CANCELADO', 450, 100);
  v_p_dividido := criar_produto('PRODUTO DIVIDIDO', 5000, 100);
  v_p_cred := criar_produto('PRODUTO CREDIARIO', 4500, 100);
  v_p_c2 := criar_produto('PRODUTO CLIENTE DOIS', 5000, 100);
  v_p_c3 := criar_produto('PRODUTO CLIENTE TRES', 1000, 100);
  v_p_baixo := criar_produto('PRODUTO ESTOQUE BAIXO', 500, 2);
  v_p_zerado := criar_produto('PRODUTO ESTOQUE ZERADO', 500, 0);
  v_p_parado := criar_produto('PRODUTO PARADO', 500, 5);

  -- custos conhecidos: e deles que sai v_lucro_periodo
  update produtos set preco_custo = 200 where id = v_p_noite;
  update produtos set preco_custo = 400 where id = v_p_lucro;
  update produtos set preco_custo = 100 where id = v_p_cancel;
  update produtos set preco_custo = 2000 where id = v_p_dividido;
  update produtos set preco_custo = 1500 where id = v_p_cred;
  update produtos set preco_custo = 1000 where id = v_p_c2;
  update produtos set preco_custo = 100 where id = v_p_c3;

  update produtos set estoque_minimo = 3 where id = v_p_baixo;
  -- parado: ativo, com estoque e criado ha 90 dias, sem nenhuma venda
  update produtos set criado_em = now() - interval '90 days' where id = v_p_parado;

  v_c1 := criar_cliente('CLIENTE UM', 100000, false);
  v_c2 := criar_cliente('CLIENTE DOIS', 100000, false);
  v_c3 := criar_cliente('CLIENTE TRES', 100000, false);

  -- ================= caso 1: venda das 22h de 05/10 em Sao Paulo =================
  v_chave := gen_random_uuid();
  v_s_noite := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_noite, 'quantidade', 2)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 2000)),
    0)->>'id')::uuid;
  update vendas set criado_em = timestamptz '2026-10-06 01:00:00+00' where id = v_s_noite;

  perform teste_ok((select count(*) = 1 from v_vendas_dia
                    where dia = date '2026-10-05' and quantidade = 1
                      and total = 900 and ticket_medio = 900),
    'caso 1: a venda das 22h de 05/10 aparece em v_vendas_dia no dia 2026-10-05');

  -- ================= caso 3: lucro com custo conhecido (dia 07/10) =================
  v_chave := gen_random_uuid();
  v_s_lucro := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_lucro, 'quantidade', 3)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 3000)),
    0)->>'id')::uuid;
  update vendas set criado_em = timestamptz '2026-10-07 13:00:00+00' where id = v_s_lucro;

  perform teste_ok((select receita = 3000 and custo = 1200 and lucro = 1800
                    from v_lucro_periodo where dia = date '2026-10-07'),
    'caso 3: v_lucro_periodo = (1000 - 400) x 3 = 1800 no dia 07/10');

  -- ================= caso 2: venda cancelada (dia 08/10) =================
  v_chave := gen_random_uuid();
  v_s_cancel := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_cancel, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000)),
    0)->>'id')::uuid;
  update vendas set criado_em = timestamptz '2026-10-08 13:00:00+00' where id = v_s_cancel;
  perform cancelar_venda(v_s_cancel, 'venda cancelada de proposito');

  perform teste_ok(not exists (select 1 from v_vendas_dia where dia = date '2026-10-08'),
    'caso 2: venda cancelada nao entra em v_vendas_dia (A7)');
  perform teste_ok(not exists (select 1 from v_lucro_periodo where dia = date '2026-10-08'),
    'caso 2: venda cancelada nao entra em v_lucro_periodo (A7)');

  -- ================= caso 4: PIX 3000 + dinheiro 2000 numa venda de 5000 =================
  v_chave := gen_random_uuid();
  v_s_dividido := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_dividido, 'quantidade', 1)),
    jsonb_build_array(
      jsonb_build_object('forma', 'pix', 'valor', 3000),
      jsonb_build_object('forma', 'dinheiro', 'valor', 2000)),
    0)->>'id')::uuid;

  perform teste_ok((select count(*) = 2 from venda_pagamentos where venda_id = v_s_dividido),
    'caso 4: a venda dividida tem duas formas de pagamento');
  perform teste_ok((select total = 3000 from v_formas_pagamento where forma = 'pix'),
    'caso 4: v_formas_pagamento mostra o PIX com 3000');
  perform teste_ok((select total = 7000 from v_formas_pagamento where forma = 'dinheiro'),
    'caso 4: v_formas_pagamento soma todo o dinheiro recebido (2000 + 3000 + 2000)');

  -- ================= caso 5: crediario fora do dinheiro =================
  v_esperado_antes := (select esperado_dinheiro from v_caixa_atual);

  v_chave := gen_random_uuid();
  v_s_cred := (registrar_venda(v_chave, v_c1,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_cred, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'crediario', 'valor', 4500)),
    0)->>'id')::uuid;

  v_esperado_depois := (select esperado_dinheiro from v_caixa_atual);
  perform teste_ok(v_esperado_antes = v_esperado_depois,
    'caso 5: a venda no crediario nao muda o esperado_dinheiro do caixa');
  perform teste_ok((select total = 4500 from v_formas_pagamento where forma = 'crediario'),
    'caso 5: o crediario aparece em v_formas_pagamento com o valor da parcela');

  -- ================= casos 6 e 7: devedores =================
  v_chave := gen_random_uuid();
  v_s_c2 := (registrar_venda(v_chave, v_c2,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_c2, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'crediario', 'valor', 5000)),
    0)->>'id')::uuid;

  v_chave := gen_random_uuid();
  v_s_c3 := (registrar_venda(v_chave, v_c3,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_c3, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'crediario', 'valor', 1000)),
    0)->>'id')::uuid;

  -- pagamento parcial do CLIENTE DOIS: 5000 de compra menos 2000 = 3000
  insert into crediario_lancamentos (cliente_id, venda_id, tipo, valor, usuario_id)
  values (v_c2, v_s_c2, 'pagamento', 2000, v_dono);

  perform teste_ok((select saldo = 3000 from v_clientes_devedores where nome = 'CLIENTE DOIS'),
    'caso 7: compra de 5000 menos pagamento de 2000 da saldo 3000');
  perform teste_ok((select total = 10500 from v_formas_pagamento where forma = 'crediario'),
    'caso 5: v_formas_pagamento soma todo o crediario do periodo (4500 + 5000 + 1000)');
  perform teste_ok((select array_agg(nome order by saldo desc, nome) = array['CLIENTE UM', 'CLIENTE DOIS', 'CLIENTE TRES']
                    from v_clientes_devedores
                    where nome in ('CLIENTE UM', 'CLIENTE DOIS', 'CLIENTE TRES')),
    'caso 6: v_clientes_devedores ordena pelo maior saldo (4500, 3000, 1000)');

  -- ================= caso 8: estoque baixo e zerado =================
  perform teste_ok((select count(*) = 1 from v_estoque_baixo where produto_id = v_p_baixo),
    'caso 8: produto com estoque 2 e minimo 3 aparece em v_estoque_baixo');
  perform teste_ok((select count(*) = 1 from v_estoque_zerado where produto_id = v_p_zerado),
    'caso 8: produto com estoque 0 aparece em v_estoque_zerado');

  -- ================= caso 9: estoque parado =================
  perform teste_ok((select count(*) = 1 from v_estoque_parado where produto_id = v_p_parado),
    'caso 9: produto com estoque e sem venda ha 61 dias ou mais aparece em v_estoque_parado');
  perform teste_ok((select count(*) = 0 from v_estoque_parado where produto_id = v_p_noite),
    'caso 9: produto com venda recente nao aparece em v_estoque_parado');

  -- ================= cobertura das duas views restantes =================
  perform teste_ok((select nome = 'PRODUTO LUCRO' and quantidade = 3
                    from v_mais_vendidos order by quantidade desc limit 1),
    'v_mais_vendidos: o produto com 3 unidades vendidas lidera o ranking');
  perform teste_ok((select total = 900 and itens is not null and formas is not null
                    from v_vendas_lista where venda_id = v_s_noite),
    'v_vendas_lista: a venda da noite aparece com total, itens e formas');
end $$;
