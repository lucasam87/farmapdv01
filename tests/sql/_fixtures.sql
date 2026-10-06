-- _fixtures.sql — o que os casos precisam para montar um cenario.
--
-- Roda dentro da transacao do caso, antes dele, e morre no ROLLBACK.
-- Comprovado por sonda: as tres tabelas alvo aceitam escrita com estas colunas
-- (em auth.users, so id e NOT NULL sem default).

create or replace function criar_usuario_teste(p_id uuid, p_email text, p_papel text default 'dono')
returns uuid language plpgsql as $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) values (
    p_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    p_email,
    '',
    now(), now(), now()
  );
  -- Sem a linha em perfis o app diz "Usuario sem perfil cadastrado".
  insert into perfis (id, nome, papel) values (p_id, p_email, p_papel);
  return p_id;
end $$;

create or replace function criar_produto(p_nome text, p_preco_venda integer, p_estoque integer)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into produtos (nome, preco_venda, estoque_atual)
  values (p_nome, p_preco_venda, p_estoque)
  returning id into v_id;
  return v_id;
end $$;

-- O indice unico parcial caixa_um_aberto_por_terminal permite um caixa aberto
-- por terminal; os casos criam um por vez. O terminal virou parametro na Task 9
-- (default 'balcao', como antes) para os casos de cancelamento.
create or replace function criar_caixa_aberto(p_usuario_id uuid, p_terminal text default 'balcao')
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into caixa_sessoes (aberto_por, status, terminal, valor_inicial)
  values (p_usuario_id, 'aberto', p_terminal, 0)
  returning id into v_id;
  return v_id;
end $$;

-- O plano da Task 6 listava quatro fixtures; os casos de crediario da Task 7
-- precisam de cliente com limite, sem limite e bloqueado.
create or replace function criar_cliente(p_nome text, p_limite integer, p_bloqueado boolean)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into clientes (nome, limite_credito, bloqueado)
  values (p_nome, p_limite, p_bloqueado)
  returning id into v_id;
  return v_id;
end $$;

-- Os casos de produto (Task 1 do plano 2) precisam de codigo de barras e estoque
-- minimo no cenario. Insere DIRETO na tabela, sem passar pela RPC, de proposito:
-- quem testa a RPC nao pode montar o cenario com ela.
create or replace function criar_produto_completo(
  p_nome text,
  p_preco_venda integer default 0,
  p_preco_custo integer default 0,
  p_codigo_barras text default null,
  p_estoque integer default 0,
  p_estoque_minimo integer default 0
) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into produtos (nome, preco_venda, preco_custo, codigo_barras,
                        estoque_atual, estoque_minimo)
  values (p_nome, p_preco_venda, p_preco_custo, p_codigo_barras,
          p_estoque, p_estoque_minimo)
  returning id into v_id;
  return v_id;
end $$;
