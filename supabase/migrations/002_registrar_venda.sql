-- 002_registrar_venda.sql
-- A funcao mais critica do sistema: registra venda, itens, pagamentos, baixa de
-- estoque, movimento de caixa e crediario numa unica transacao, seguindo a
-- ordem exata da spec secao 8.1 e as mensagens da secao 9.
--
-- Dinheiro SEMPRE em centavos inteiros.

-- ============================================================
-- Formatacao de dinheiro para as mensagens da spec 9 ("Faltam R$ 12,00...",
-- "Limite excedido. Divida atual R$ 120,00 ..."). Feita a mao de proposito:
-- to_char usa lc_numeric do banco, que nao e pt-BR neste projeto, e daria
-- "1,234.56" em vez de "1.234,56".
-- ============================================================
create or replace function centavos_em_reais(p_centavos integer)
returns text
language plpgsql
immutable
as $$
declare
  v_inteiro text;
  v_milhares text := '';
begin
  v_inteiro := (abs(p_centavos) / 100)::text;
  while length(v_inteiro) > 3 loop
    v_milhares := '.' || right(v_inteiro, 3) || v_milhares;
    v_inteiro := left(v_inteiro, length(v_inteiro) - 3);
  end loop;
  return 'R$ ' || case when p_centavos < 0 then '-' else '' end
    || v_inteiro || v_milhares || ','
    || lpad((abs(p_centavos) % 100)::text, 2, '0');
end $$;

-- ============================================================
-- registrar_venda: tudo ou nada.
-- ============================================================
create or replace function registrar_venda(
  p_chave_idempotencia uuid,
  p_cliente_id uuid,
  p_itens jsonb,
  p_pagamentos jsonb,
  p_desconto integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario    uuid := auth.uid();
  v_perfil     perfis%rowtype;
  v_venda      vendas%rowtype;
  v_cliente    clientes%rowtype;
  v_produto    produtos%rowtype;
  v_caixa_id   uuid;
  v_item       jsonb;
  v_pag        jsonb;
  v_itens      jsonb;
  v_linhas     jsonb := '[]'::jsonb;
  v_id_texto   text;
  v_qtd_texto  text;
  v_produto_id uuid;
  v_quantidade integer;
  v_subtotal   integer := 0;
  v_desconto   integer;
  v_total      integer;
  v_dinheiro   integer := 0;
  v_pix        integer := 0;
  v_debito     integer := 0;
  v_credito    integer := 0;
  v_crediario  integer := 0;
  v_cartao     integer := 0;
  v_falta      integer;
  v_troco      integer := 0;
  v_divida     integer := 0;
  v_saldo      integer;
  v_forma      text;
  v_valor      integer;
begin
  -- ---- 1. usuario logado e papel autorizado (spec 8.5) ----
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;
  select * into v_perfil from perfis where id = v_usuario;
  if not found then
    raise exception 'Usuário sem perfil cadastrado. Fale com o responsável.';
  end if;
  if not v_perfil.ativo then
    raise exception 'Usuário desativado. Fale com o responsável.';
  end if;

  -- ---- 1b. chave de idempotencia ja usada: devolve a venda e encerra ANTES de
  -- qualquer outra validacao (spec 8.1 passo 1). E o que impede a venda dupla
  -- quando o atendente clica duas vezes. ----
  select * into v_venda from vendas where chave_idempotencia = p_chave_idempotencia;
  if found then
    return jsonb_build_object('id', v_venda.id, 'numero', v_venda.numero,
                              'total', v_venda.total, 'troco', v_venda.troco);
  end if;

  -- ---- 2. caixa aberto ----
  select id into v_caixa_id
  from caixa_sessoes
  where status = 'aberto'
  order by aberto_em desc
  limit 1;
  if v_caixa_id is null then
    raise exception 'Abra o caixa para começar a vender.';
  end if;

  -- ---- 3. carrinho nao vazio ----
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Carrinho vazio.';
  end if;

  -- ---- 4/5. valida CADA item antes de qualquer cast (spec 8.1 passo 5).
  -- Sem isso "1.5" viraria "invalid input syntax for type integer" na cara do
  -- atendente (Review Focus A2/A11). ----
  for v_item in select * from jsonb_array_elements(p_itens) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Item inválido no carrinho.';
    end if;

    v_id_texto := v_item->>'produto_id';
    if v_id_texto is null or v_id_texto !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'Produto inválido no carrinho.';
    end if;

    select * into v_produto from produtos where id = v_id_texto::uuid;
    if not found then
      raise exception 'Produto não encontrado no cadastro.';
    end if;
    if not v_produto.ativo then
      raise exception 'O produto % está inativo.', v_produto.nome;
    end if;

    v_qtd_texto := v_item->>'quantidade';
    -- O texto e validado antes do cast e o limite de 9 digitos impede o
    -- overflow do integer: 99999999999 cai na mensagem em portugues, nao em
    -- "integer out of range".
    v_quantidade := case
      when v_qtd_texto ~ '^\d+$' and length(v_qtd_texto) <= 9 then v_qtd_texto::integer
    end;
    if v_quantidade is null or v_quantidade < 1 or v_quantidade > 9999 then
      raise exception 'Quantidade inválida no item %. Use um número inteiro de 1 a 9999.',
        v_produto.nome;
    end if;
  end loop;

  -- ---- 4b. agrega por produto (x3 + x4 -> x7), em ordem fixa de produto_id ----
  select jsonb_agg(jsonb_build_object('produto_id', produto_id, 'quantidade', quantidade)
                   order by produto_id)
    into v_itens
  from (
    select (item->>'produto_id')::uuid as produto_id,
           sum((item->>'quantidade')::integer) as quantidade
    from jsonb_array_elements(p_itens) as item
    group by 1
  ) t;

  -- ---- 6/7/8. trava as linhas em ordem fixa (evita deadlock entre vendas
  -- simultaneas), confere o estoque do total agregado e monta o subtotal com o
  -- preco do banco — nunca com preco vindo do carrinho ----
  for v_item in select * from jsonb_array_elements(v_itens) loop
    v_produto_id := (v_item->>'produto_id')::uuid;
    v_quantidade := (v_item->>'quantidade')::integer;

    select * into v_produto from produtos where id = v_produto_id for update;

    if v_produto.estoque_atual < v_quantidade then
      raise exception 'Estoque insuficiente para % (sistema: %, pedido: %). Faça um ajuste de inventário.',
        v_produto.nome, v_produto.estoque_atual, v_quantidade;
    end if;

    v_subtotal := v_subtotal + v_produto.preco_venda * v_quantidade;
    v_linhas := v_linhas || jsonb_build_object(
      'produto_id', v_produto.id,
      'nome', v_produto.nome,
      'quantidade', v_quantidade,
      'preco_unitario', v_produto.preco_venda,
      'preco_custo', v_produto.preco_custo);
  end loop;

  -- ---- 9. desconto e total: desconto que zera a venda e recusado
  -- (Review Focus A10) ----
  v_desconto := coalesce(p_desconto, 0);
  if v_desconto < 0 then
    raise exception 'O desconto não pode ser negativo.';
  end if;
  if v_desconto > v_subtotal then
    raise exception 'O desconto não pode ser maior que o subtotal.';
  end if;
  v_total := v_subtotal - v_desconto;
  if v_total <= 0 then
    raise exception 'O desconto não pode zerar a venda.';
  end if;

  -- ---- 10. pagamentos ----
  if p_pagamentos is null or jsonb_typeof(p_pagamentos) <> 'array' then
    p_pagamentos := '[]'::jsonb;
  end if;

  for v_pag in select * from jsonb_array_elements(p_pagamentos) loop
    v_forma := v_pag->>'forma';
    v_valor := case
      when (v_pag->>'valor') ~ '^\d+$' and length(v_pag->>'valor') <= 9
      then (v_pag->>'valor')::integer
    end;
    if v_valor is null or v_valor <= 0 then
      raise exception 'Valor de pagamento inválido.';
    end if;

    if v_forma = 'dinheiro' then
      v_dinheiro := v_dinheiro + v_valor;
    elsif v_forma = 'pix' then
      v_pix := v_pix + v_valor;
    elsif v_forma = 'debito' then
      v_debito := v_debito + v_valor;
    elsif v_forma = 'credito' then
      v_credito := v_credito + v_valor;
    elsif v_forma = 'crediario' then
      v_crediario := v_crediario + v_valor;
    else
      raise exception 'Forma de pagamento desconhecida: %.', coalesce(v_forma, '(vazia)');
    end if;
  end loop;

  v_cartao := v_pix + v_debito + v_credito;
  if v_cartao > v_total then
    raise exception 'O valor no cartão não pode ser maior que o total.';
  end if;
  if v_cartao + v_crediario > v_total then
    raise exception 'A soma dos pagamentos não pode ser maior que o total.';
  end if;

  -- crediario: exige cliente, nao bloqueado, com crediario liberado e folga no
  -- limite (spec 8.4)
  if v_crediario > 0 then
    if p_cliente_id is null then
      raise exception 'Crediário exige cliente.';
    end if;
    select * into v_cliente from clientes where id = p_cliente_id;
    if not found then
      raise exception 'Cliente não encontrado no cadastro.';
    end if;
    if v_cliente.bloqueado then
      raise exception 'Este cliente está bloqueado para crediário.';
    end if;
    if v_cliente.limite_credito <= 0 then
      raise exception 'Este cliente não tem crediário liberado.';
    end if;

    select coalesce(sum(case when tipo = 'compra' then valor else -valor end), 0)
      into v_divida
    from crediario_lancamentos
    where cliente_id = p_cliente_id;

    if v_divida + v_crediario > v_cliente.limite_credito then
      raise exception 'Limite excedido. Dívida atual % + esta venda % = % (limite %).',
        centavos_em_reais(v_divida), centavos_em_reais(v_crediario),
        centavos_em_reais(v_divida + v_crediario), centavos_em_reais(v_cliente.limite_credito);
    end if;
  end if;

  -- O dinheiro cobre o que falta e pode exceder; o troco sai SO do dinheiro
  -- (spec 8.1 passo 10).
  v_falta := v_total - v_cartao - v_crediario;
  if v_dinheiro < v_falta then
    raise exception 'Faltam % para fechar a venda.', centavos_em_reais(v_falta - v_dinheiro);
  end if;
  v_troco := v_dinheiro - v_falta;

  -- ---- 11. grava tudo ----
  insert into vendas (chave_idempotencia, cliente_id, caixa_sessao_id, usuario_id,
                      subtotal, desconto, total, valor_pago, troco)
  values (p_chave_idempotencia, p_cliente_id, v_caixa_id, v_usuario,
          v_subtotal, v_desconto, v_total, v_dinheiro + v_cartao + v_crediario, v_troco)
  returning * into v_venda;

  for v_item in select * from jsonb_array_elements(v_linhas) loop
    insert into venda_itens (venda_id, produto_id, nome_produto, quantidade,
                             preco_unitario, preco_custo, total)
    values (v_venda.id, (v_item->>'produto_id')::uuid, v_item->>'nome',
            (v_item->>'quantidade')::integer, (v_item->>'preco_unitario')::integer,
            (v_item->>'preco_custo')::integer,
            (v_item->>'preco_unitario')::integer * (v_item->>'quantidade')::integer);

    update produtos
       set estoque_atual = estoque_atual - (v_item->>'quantidade')::integer,
           atualizado_em = now()
     where id = (v_item->>'produto_id')::uuid
    returning estoque_atual into v_saldo;

    -- livro-razao do estoque: quantidade negativa porque saiu
    insert into estoque_movimentos (produto_id, tipo, quantidade, saldo_apos, venda_id, usuario_id)
    values ((v_item->>'produto_id')::uuid, 'venda', -((v_item->>'quantidade')::integer),
            v_saldo, v_venda.id, v_usuario);
  end loop;

  for v_pag in select * from jsonb_array_elements(p_pagamentos) loop
    insert into venda_pagamentos (venda_id, forma, valor)
    values (v_venda.id, v_pag->>'forma', (v_pag->>'valor')::integer);
  end loop;

  -- Um movimento de caixa por forma. O dinheiro entra liquido de troco, que e
  -- o que a conta do fechamento espera (spec 8.3). O crediario aparece no
  -- movimento, mas nao entra em esperado_dinheiro.
  if v_dinheiro > 0 then
    insert into caixa_movimentos (sessao_id, tipo, forma, valor, venda_id, usuario_id)
    values (v_caixa_id, 'venda', 'dinheiro', v_dinheiro - v_troco, v_venda.id, v_usuario);
  end if;
  if v_pix > 0 then
    insert into caixa_movimentos (sessao_id, tipo, forma, valor, venda_id, usuario_id)
    values (v_caixa_id, 'venda', 'pix', v_pix, v_venda.id, v_usuario);
  end if;
  if v_debito > 0 then
    insert into caixa_movimentos (sessao_id, tipo, forma, valor, venda_id, usuario_id)
    values (v_caixa_id, 'venda', 'debito', v_debito, v_venda.id, v_usuario);
  end if;
  if v_credito > 0 then
    insert into caixa_movimentos (sessao_id, tipo, forma, valor, venda_id, usuario_id)
    values (v_caixa_id, 'venda', 'credito', v_credito, v_venda.id, v_usuario);
  end if;
  if v_crediario > 0 then
    insert into caixa_movimentos (sessao_id, tipo, forma, valor, venda_id, usuario_id)
    values (v_caixa_id, 'venda', 'crediario', v_crediario, v_venda.id, v_usuario);

    -- a divida em si, apenas sobre a parcela do crediario
    insert into crediario_lancamentos (cliente_id, venda_id, tipo, valor, forma_pagamento, usuario_id)
    values (p_cliente_id, v_venda.id, 'compra', v_crediario, 'crediario', v_usuario);
  end if;

  return jsonb_build_object('id', v_venda.id, 'numero', v_venda.numero,
                            'total', v_venda.total, 'troco', v_venda.troco);
end $$;

-- A spec 5 diz que estas sao as unicas escritas que o front provoca: quem chama
-- e o usuario logado (authenticated). O service_role continua podendo chamar
-- para scripts administrativos.
revoke all on function registrar_venda(uuid, uuid, jsonb, jsonb, integer) from public;
grant execute on function registrar_venda(uuid, uuid, jsonb, jsonb, integer)
  to authenticated, service_role;
