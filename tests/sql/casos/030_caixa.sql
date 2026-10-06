-- 030_caixa.sql — casos de abrir_caixa, caixa_movimento e fechar_caixa
-- (formula da spec secao 8.3).
--
-- Duas sessoes, nesta ordem, porque abrir_caixa recusa um segundo caixa aberto:
--   sessao A: casos 1, 2, 3, 4, 5 e um fechamento com diferenca zero, que e o
--             que prova que sangria/suprimento entram, que o troco NAO infla o
--             caixa e que PIX fica fora do dinheiro;
--   sessao B: casos 6, 7 e 8 (esperado 7900, contado 7800, diferenca -100).
-- Depois disso, casos 9 e 10 (caixa fechado).

do $$
declare
  v_dono      uuid;
  v_caixa_a   uuid;
  v_caixa_b   uuid;
  v_produto   uuid;
  v_chave     uuid;
  v_resultado jsonb;
begin
  -- ================= cenario =================
  v_dono := criar_usuario_teste(gen_random_uuid(), 'caixa@farmacia.local');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  v_produto := criar_produto('PRODUTO CAIXA', 450, 100);

  -- ================= caso 1: abrir caixa com R$ 100,00 =================
  v_caixa_a := abrir_caixa(10000);
  perform teste_ok((select status = 'aberto' and valor_inicial = 10000 and aberto_por = v_dono
                    from caixa_sessoes where id = v_caixa_a),
    'caso 1: abrir caixa com R$ 100,00 deixa a sessao aberta');
  perform teste_ok((select count(*) = 1 from caixa_sessoes where status = 'aberto'),
    'caso 1: existe exatamente uma sessao aberta');

  -- ================= caso 2: segundo caixa =================
  perform teste_erro('select abrir_caixa(5000)',
    'Já existe um caixa aberto.',
    'caso 2: abrir um segundo caixa e recusado');

  -- ================= validacoes de caixa_movimento =================
  perform teste_erro('select caixa_movimento(''retirada'', 100, ''teste'')',
    'Movimento de caixa inválido',
    'movimento com tipo desconhecido e recusado');
  perform teste_erro('select caixa_movimento(''sangria'', -100, ''teste'')',
    'maior que zero',
    'movimento com valor negativo e recusado');
  perform teste_erro('select caixa_movimento(''sangria'', 100, ''   '')',
    'Informe o motivo',
    'movimento sem motivo e recusado');

  -- ================= caso 3: sangria de 3000 e suprimento de 1000 =================
  perform caixa_movimento('sangria', 3000, 'deposito bancario');
  perform caixa_movimento('suprimento', 1000, 'troco para o balcao');
  perform teste_ok((select count(*) = 1 from caixa_movimentos
                    where sessao_id = v_caixa_a and tipo = 'sangria'
                      and valor = -3000 and motivo = 'deposito bancario'),
    'caso 3: sangria gravada negativa, com o motivo');
  perform teste_ok((select count(*) = 1 from caixa_movimentos
                    where sessao_id = v_caixa_a and tipo = 'suprimento' and valor = 1000),
    'caso 3: suprimento gravado positivo');
  perform teste_ok((select coalesce(sum(case when tipo = 'sangria' then -abs(valor) else abs(valor) end), 0) = -2000
                    from caixa_movimentos where sessao_id = v_caixa_a),
    'caso 3: o par sangria/suprimento derruba o esperado em 2000');

  -- ================= caso 4: venda de 900 em dinheiro com 2000 recebidos =================
  v_chave := gen_random_uuid();
  perform registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_produto, 'quantidade', 2)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 2000)),
    0);
  perform teste_ok((select count(*) = 1 from caixa_movimentos
                    where sessao_id = v_caixa_a and tipo = 'venda'
                      and forma = 'dinheiro' and valor = 900),
    'caso 4: a venda entra como 900 — o troco de 1100 nao conta como entrada');

  -- ================= caso 5: venda no PIX =================
  v_chave := gen_random_uuid();
  perform registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_produto, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 450)),
    0);
  perform teste_ok((select count(*) = 0 from caixa_movimentos
                    where sessao_id = v_caixa_a and tipo = 'venda' and forma = 'dinheiro'
                      and venda_id = (select id from vendas where chave_idempotencia = v_chave)),
    'caso 5: a venda no PIX nao cria movimento de dinheiro');

  -- ================= fechamento da sessao A =================
  -- 10000 - 3000 + 1000 + 900 = 8900. Se a sangria/suprimento fossem
  -- ignorados, se o troco inflasse o caixa ou se o PIX entrasse, este numero
  -- nao fecharia.
  v_resultado := fechar_caixa(8900, null);
  perform teste_ok((v_resultado->>'esperado_dinheiro')::integer = 8900,
    'esperado da sessao A = 8900 (inicial + suprimento - sangria + venda liquida de troco; PIX fora)');
  perform teste_ok((v_resultado->>'diferenca')::integer = 0,
    'contado igual ao esperado: diferenca zero');
  perform teste_ok((select status = 'fechado' and valor_contado = 8900
                      and esperado_dinheiro = 8900 and diferenca = 0
                      and fechado_por = v_dono and fechado_em is not null
                    from caixa_sessoes where id = v_caixa_a),
    'o fechamento gravou contado, esperado, diferenca, quem fechou e quando');
  perform teste_ok((select count(*) = 0 from caixa_sessoes where status = 'aberto'),
    'depois do fechamento nao ha sessao aberta');

  -- ================= sessao B: casos 6, 7 e 8 =================
  v_caixa_b := abrir_caixa(10000);
  perform caixa_movimento('sangria', 3000, 'pagamento de fornecedor');
  v_chave := gen_random_uuid();
  perform registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_produto, 'quantidade', 2)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000)),
    0);

  -- ================= caso 8: diferenca sem observacao =================
  perform teste_erro('select fechar_caixa(7800, null)',
    'precisa de observação',
    'caso 8: fechar com diferenca e sem observacao e recusado');
  perform teste_erro('select fechar_caixa(7800, ''   '')',
    'precisa de observação',
    'caso 8: observacao so com espacos nao vale');
  perform teste_ok((select status = 'aberto' from caixa_sessoes where id = v_caixa_b),
    'caso 8: a sessao continua aberta depois da recusa');

  -- ================= casos 6 e 7 =================
  v_resultado := fechar_caixa(7800, 'faltou troco no balcao');
  perform teste_ok((v_resultado->>'esperado_dinheiro')::integer = 7900,
    'caso 6: esperado = 7900 (inicial 10000 + venda em dinheiro 900 - sangria 3000)');
  perform teste_ok((v_resultado->>'diferenca')::integer = -100,
    'caso 7: contado 7800 da diferenca -100 e o fechamento acontece');
  perform teste_ok((select status = 'fechado' and diferenca = -100
                      and observacao = 'faltou troco no balcao'
                    from caixa_sessoes where id = v_caixa_b),
    'caso 7: a sessao ficou fechada com a observacao');

  -- ================= caso 9: mexer em caixa ja fechado =================
  perform teste_erro('select caixa_movimento(''sangria'', 100, ''teste'')',
    'Abra o caixa para começar a vender.',
    'caso 9: sangria sem caixa aberto e recusada');
  perform teste_erro('select fechar_caixa(100, null)',
    'Não há caixa aberto.',
    'caso 9: fechar de novo e recusado');

  -- ================= caso 10: caixa fechado e tentativa de venda =================
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, null, %L::jsonb, %L::jsonb, 0)', v_chave,
      jsonb_build_array(jsonb_build_object('produto_id', v_produto, 'quantidade', 1))::text,
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000))::text),
    'Abra o caixa para começar a vender.',
    'caso 10: venda com o caixa fechado e recusada');

  -- ================= valor inicial negativo =================
  perform teste_erro('select abrir_caixa(-1)',
    'não pode ser negativo',
    'abrir caixa com valor inicial negativo e recusado');
end $$;
