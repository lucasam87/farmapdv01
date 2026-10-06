-- _helper.sql — ferramentas de assercao dos casos de teste.
--
-- Por que nao usa raise notice: o endpoint de SQL que o runner usa NAO devolve
-- as mensagens de notice (comprovado por sonda: HTTP 201 com corpo vazio).
-- Entao o nome de cada assercao que passou vai para uma tabela temporaria, que
-- o runner le com um select antes do ROLLBACK.
--
-- Este arquivo roda dentro da transacao do caso: a tabela e a funcao morrem no
-- ROLLBACK e nao ficam no banco.

create temp table if not exists teste_log (ordem serial, nome text);
truncate teste_log;

create or replace function teste_ok(p_condicao boolean, p_nome text)
returns void language plpgsql as $$
begin
  if p_condicao is null or not p_condicao then
    raise exception 'FALHOU: %', p_nome;
  end if;
  insert into teste_log (nome) values (p_nome);
end $$;

-- Espera que o SQL levante excecao e que a mensagem contenha o trecho dado
-- (comparacao sem diferenciar maiuscula de minuscula). Uma excecao que nao
-- vem — ou que vem com outra mensagem — e falha nomeada.
create or replace function teste_erro(p_sql text, p_trecho text, p_nome text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_trecho) in lower(sqlerrm)) = 0 then
      raise exception 'FALHOU: % — esperava mensagem com "%", veio "%"', p_nome, p_trecho, sqlerrm;
    end if;
    insert into teste_log (nome) values (p_nome);
    return;
  end;
  raise exception 'FALHOU: % — nenhuma excecao foi levantada', p_nome;
end $$;
