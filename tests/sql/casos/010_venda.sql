-- 010_venda.sql — casos de registrar_venda (spec secao 8.1, mensagens da 9).
--
-- O usuario logado e simulado com request.jwt.claims, que e de onde auth.uid()
-- le o usuario_id. Os casos rodam como o dono do banco, sem trocar de role
-- (ruling registrado no ledger do plano).
--
-- O caso 18 do plano (venda as 22h de 05/10 aparecendo em v_vendas_dia no dia
-- 05/10) depende das views da Task 11: ele mora no arquivo de teste da Task 11,
-- onde a view existe — nenhum teste fica escrito e sem rodar.

do $$
declare
  v_usuario      uuid;
  v_caixa        uuid;
  v_p_simples    uuid;
  v_p_agregado   uuid;
  v_p_qtd        uuid;
  v_p_cartao     uuid;
  v_p_cred       uuid;
  v_c_limite     uuid;
  v_c_apertado   uuid;
  v_c_sem_limite uuid;
  v_c_bloqueado  uuid;
  v_chave        uuid;
  v_venda        jsonb;
  v_venda2       jsonb;
begin
  -- ================= cenario =================
  v_usuario := criar_usuario_teste(gen_random_uuid(), 'venda@farmacia.local');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);

  v_p_simples  := criar_produto('PARACETAMOL 500mg', 450, 10);
  v_p_agregado := criar_produto('DIPIRONA 500mg', 450, 5);
  v_p_qtd      := criar_produto('IBUPROFENO 400mg', 300, 10);
  v_p_cartao   := criar_produto('DIPIRONA GOTAS 20ml', 5000, 10);
  v_p_cred     := criar_produto('AMOXICILINA 500mg', 4500, 10);

  v_c_limite     := criar_cliente('MARIA CREDIARIO', 10000, false);
  v_c_apertado   := criar_cliente('JOAO LIMITE BAIXO', 3000, false);
  v_c_sem_limite := criar_cliente('ANA SEM CREDIARIO', 0, false);
  v_c_bloqueado  := criar_cliente('PEDRO BLOQUEADO', 10000, true);

  v_caixa := criar_caixa_aberto(v_usuario);

  -- ================= caso 1: venda simples com dinheiro a mais =================
  v_chave := gen_random_uuid();
  v_venda := registrar_venda(
    v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_simples, 'quantidade', 2)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 2000)),
    0);
  perform teste_ok((v_venda->>'total')::integer = 900,
    'caso 1: total = 900 (2 x R$ 4,50)');
  perform teste_ok((v_venda->>'troco')::integer = 1100,
    'caso 1: troco = 1100 (R$ 20,00 menos R$ 9,00)');
  perform teste_ok((select estoque_atual = 8 from produtos where id = v_p_simples),
    'caso 1: estoque caiu de 10 para 8');
  perform teste_ok((select count(*) = 1 from caixa_movimentos
                    where venda_id = (v_venda->>'id')::uuid and forma = 'dinheiro' and valor = 900),
    'caso 1: um movimento de caixa em dinheiro, liquido de troco (900)');
  perform teste_ok(has_function_privilege(
                     'authenticated', 'registrar_venda(uuid,uuid,jsonb,jsonb,integer)', 'execute'),
    'caso 1: a funcao esta executavel pelo papel authenticated');

  -- ================= caso 2: x3 + x4 do mesmo produto com estoque 5 =================
  -- Review Focus A1: agregar por produto ANTES de validar estoque.
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, null, %L::jsonb, %L::jsonb, 0)', v_chave,
      jsonb_build_array(
        jsonb_build_object('produto_id', v_p_agregado, 'quantidade', 3),
        jsonb_build_object('produto_id', v_p_agregado, 'quantidade', 4))::text,
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 10000))::text),
    'Estoque insuficiente para DIPIRONA 500mg (sistema: 5, pedido: 7). Faça um ajuste de inventário.',
    'caso 2: x3 + x4 do mesmo produto com estoque 5 e recusado');
  perform teste_ok((select estoque_atual = 5 from produtos where id = v_p_agregado),
    'caso 2: estoque continua 5 (nada foi baixado)');

  -- ================= caso 3: quantidade 0 e -1 =================
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, null, %L::jsonb, %L::jsonb, 0)', v_chave,
      jsonb_build_array(jsonb_build_object('produto_id', v_p_qtd, 'quantidade', 0))::text,
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000))::text),
    'Quantidade inválida no item IBUPROFENO 400mg. Use um número inteiro de 1 a 9999.',
    'caso 3a: quantidade 0 e recusada');

  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, null, %L::jsonb, %L::jsonb, 0)', v_chave,
      jsonb_build_array(jsonb_build_object('produto_id', v_p_qtd, 'quantidade', -1))::text,
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000))::text),
    'Quantidade inválida no item IBUPROFENO 400mg. Use um número inteiro de 1 a 9999.',
    'caso 3b: quantidade -1 e recusada');
  perform teste_ok((select estoque_atual = 10 from produtos where id = v_p_qtd),
    'caso 3: estoque intacto');

  -- ================= caso 4: quantidade fracionaria "1.5" =================
  -- Review Focus A2/A11: erro em portugues, nunca "invalid input syntax".
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, null, %L::jsonb, %L::jsonb, 0)', v_chave,
      jsonb_build_array(jsonb_build_object('produto_id', v_p_qtd, 'quantidade', '1.5'))::text,
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000))::text),
    'Quantidade inválida no item IBUPROFENO 400mg. Use um número inteiro de 1 a 9999.',
    'caso 4: quantidade "1.5" e recusada com mensagem em portugues');

  -- ================= caso 5: quantidade absurda =================
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, null, %L::jsonb, %L::jsonb, 0)', v_chave,
      jsonb_build_array(jsonb_build_object('produto_id', v_p_qtd, 'quantidade', 999999))::text,
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000))::text),
    'Quantidade inválida no item IBUPROFENO 400mg. Use um número inteiro de 1 a 9999.',
    'caso 5: quantidade 999999 e recusada, sem "integer out of range"');
  perform teste_ok((select estoque_atual = 10 from produtos where id = v_p_qtd),
    'caso 5: estoque intacto');

  -- ================= caso 6: sem caixa aberto =================
  update caixa_sessoes set status = 'fechado' where id = v_caixa;
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, null, %L::jsonb, %L::jsonb, 0)', v_chave,
      jsonb_build_array(jsonb_build_object('produto_id', v_p_simples, 'quantidade', 1))::text,
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000))::text),
    'Abra o caixa para começar a vender.',
    'caso 6: venda sem caixa aberto e recusada');
  perform teste_ok((select count(*) = 0 from vendas where chave_idempotencia = v_chave),
    'caso 6: nada foi gravado');
  v_caixa := criar_caixa_aberto(v_usuario);

  -- ================= caso 7: desconto maior que o subtotal =================
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, null, %L::jsonb, %L::jsonb, 5000)', v_chave,
      jsonb_build_array(jsonb_build_object('produto_id', v_p_cred, 'quantidade', 1))::text,
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000))::text),
    'O desconto não pode ser maior que o subtotal.',
    'caso 7: desconto maior que o subtotal e recusado');

  -- ================= caso 8: desconto que zera a venda =================
  -- Review Focus 1 / spec 8.1 passo 9: dar o produto de graca nao passa.
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, null, %L::jsonb, %L::jsonb, 4500)', v_chave,
      jsonb_build_array(jsonb_build_object('produto_id', v_p_cred, 'quantidade', 1))::text,
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000))::text),
    'O desconto não pode zerar a venda.',
    'caso 8: desconto igual ao subtotal e recusado');

  -- ================= caso 9: PIX acima do total =================
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, null, %L::jsonb, %L::jsonb, 0)', v_chave,
      jsonb_build_array(jsonb_build_object('produto_id', v_p_cartao, 'quantidade', 1))::text,
      jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 6000))::text),
    'O valor no cartão não pode ser maior que o total.',
    'caso 9: PIX 6000 numa venda de 5000 e recusado');

  -- ================= caso 10: PIX 3000 + dinheiro 2500 numa venda de 5000 =================
  v_chave := gen_random_uuid();
  v_venda := registrar_venda(
    v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_cartao, 'quantidade', 1)),
    jsonb_build_array(
      jsonb_build_object('forma', 'pix', 'valor', 3000),
      jsonb_build_object('forma', 'dinheiro', 'valor', 2500)),
    0);
  perform teste_ok((v_venda->>'total')::integer = 5000,
    'caso 10: venda de 5000 criada com pagamento dividido');
  perform teste_ok((v_venda->>'troco')::integer = 500,
    'caso 10: troco = 500 (dinheiro menos o que faltava)');
  perform teste_ok((select count(*) = 2 from caixa_movimentos where venda_id = (v_venda->>'id')::uuid),
    'caso 10: um movimento de caixa por forma (pix e dinheiro)');
  perform teste_ok((select count(*) = 1 from caixa_movimentos
                    where venda_id = (v_venda->>'id')::uuid and forma = 'dinheiro' and valor = 2000),
    'caso 10: o dinheiro entra no caixa liquido de troco (2500 - 500)');

  -- ================= caso 11: crediario dentro do limite =================
  v_chave := gen_random_uuid();
  v_venda := registrar_venda(
    v_chave, v_c_limite,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_cred, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'crediario', 'valor', 4500)),
    0);
  perform teste_ok((v_venda->>'total')::integer = 4500,
    'caso 11: venda no crediario criada com total 4500');
  perform teste_ok((select count(*) = 1 from crediario_lancamentos
                    where venda_id = (v_venda->>'id')::uuid and tipo = 'compra' and valor = 4500),
    'caso 11: lancamento de compra no crediario com o valor da parcela');
  perform teste_ok((select coalesce(sum(case when tipo = 'compra' then valor else -valor end), 0) = 4500
                    from crediario_lancamentos where cliente_id = v_c_limite),
    'caso 11: a divida do cliente virou 4500');
  perform teste_ok((select count(*) = 0 from caixa_movimentos
                    where venda_id = (v_venda->>'id')::uuid and forma = 'dinheiro'),
    'caso 11: crediario nao entra no caixa em dinheiro');

  -- ================= caso 12: crediario acima do limite =================
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, %L, %L::jsonb, %L::jsonb, 0)', v_chave, v_c_apertado,
      jsonb_build_array(jsonb_build_object('produto_id', v_p_cred, 'quantidade', 1))::text,
      jsonb_build_array(jsonb_build_object('forma', 'crediario', 'valor', 4500))::text),
    'Limite excedido. Dívida atual R$ 0,00 + esta venda R$ 45,00 = R$ 45,00 (limite R$ 30,00).',
    'caso 12: crediario acima do limite e recusado');

  -- ================= caso 13: cliente sem crediario liberado =================
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, %L, %L::jsonb, %L::jsonb, 0)', v_chave, v_c_sem_limite,
      jsonb_build_array(jsonb_build_object('produto_id', v_p_cred, 'quantidade', 1))::text,
      jsonb_build_array(jsonb_build_object('forma', 'crediario', 'valor', 4500))::text),
    'Este cliente não tem crediário liberado.',
    'caso 13: cliente com limite_credito = 0 e recusado');

  -- ================= caso 14: cliente bloqueado =================
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, %L, %L::jsonb, %L::jsonb, 0)', v_chave, v_c_bloqueado,
      jsonb_build_array(jsonb_build_object('produto_id', v_p_cred, 'quantidade', 1))::text,
      jsonb_build_array(jsonb_build_object('forma', 'crediario', 'valor', 4500))::text),
    'Este cliente está bloqueado para crediário.',
    'caso 14: cliente bloqueado e recusado');

  -- ================= caso 15: crediario sem cliente =================
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, null, %L::jsonb, %L::jsonb, 0)', v_chave,
      jsonb_build_array(jsonb_build_object('produto_id', v_p_cred, 'quantidade', 1))::text,
      jsonb_build_array(jsonb_build_object('forma', 'crediario', 'valor', 4500))::text),
    'Crediário exige cliente.',
    'caso 15: crediario sem cliente e recusado');

  -- ================= caso 16: idempotencia =================
  v_chave := gen_random_uuid();
  v_venda := registrar_venda(
    v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_simples, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000)),
    0);
  -- A segunda chamada vem com carrinho vazio de proposito: a spec 8.1 passo 1
  -- manda devolver a venda existente ANTES de qualquer outra validacao.
  v_venda2 := registrar_venda(v_chave, null, '[]'::jsonb, '[]'::jsonb, 0);
  perform teste_ok(v_venda2->>'id' = v_venda->>'id',
    'caso 16: a segunda chamada devolve o mesmo id');
  perform teste_ok((v_venda2->>'numero')::bigint = (v_venda->>'numero')::bigint,
    'caso 16: a segunda chamada devolve o mesmo numero');
  perform teste_ok((v_venda2->>'total')::integer = (v_venda->>'total')::integer,
    'caso 16: a segunda chamada devolve o mesmo total');
  perform teste_ok((select count(*) = 1 from vendas where chave_idempotencia = v_chave),
    'caso 16: existe exatamente uma venda com essa chave');
  perform teste_ok((select estoque_atual = 7 from produtos where id = v_p_simples),
    'caso 16: o estoque baixou uma vez so (8 para 7)');

  -- ================= caso 17: carrinho vazio =================
  v_chave := gen_random_uuid();
  perform teste_erro(
    format('select registrar_venda(%L, null, %L::jsonb, %L::jsonb, 0)', v_chave,
      '[]',
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000))::text),
    'Carrinho vazio.',
    'caso 17: carrinho vazio e recusado');

  -- caso 18 (fuso de Sao Paulo em v_vendas_dia) roda no arquivo da Task 11.
end $$;
