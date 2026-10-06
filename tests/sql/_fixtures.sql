-- _fixtures.sql — o que os casos precisam para montar um cenario.
--
-- Roda dentro da transacao do caso, antes dele, e morre no ROLLBACK.
-- Comprovado por sonda: as tres tabelas alvo aceitam escrita com estas colunas
-- (em auth.users, so id e NOT NULL sem default).

create or replace function criar_usuario_teste(p_id uuid, p_email text)
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
  insert into perfis (id, nome, papel) values (p_id, p_email, 'dono');
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
-- por terminal; os casos criam um por vez.
create or replace function criar_caixa_aberto(p_usuario_id uuid)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into caixa_sessoes (aberto_por, status, valor_inicial)
  values (p_usuario_id, 'aberto', 0)
  returning id into v_id;
  return v_id;
end $$;
