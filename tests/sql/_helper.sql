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
