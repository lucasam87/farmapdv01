do $$
declare
  v_codigo_barras text;
begin
  -- O numero de tabelas muda a cada etapa que acrescenta tabela (a etapa 8
  -- acrescentou as DUAS do orcamento do agente, 017_orcamento_agente.sql: 10 -> 12).
  -- A contagem exata existe para ninguem criar tabela sem atualizar este caso de
  -- proposito; o que importa de verdade e a segunda assercao: TODA tabela do
  -- schema public tem RLS ligada, e nenhuma nova pode nascer sem.
  perform teste_ok(
    (select count(*) = 12 from pg_tables where schemaname = 'public'),
    'existem 12 tabelas no schema public');
  -- Esta e escrita como "nenhuma tabela SEM RLS" (e nao como "as 12 com RLS") de
  -- proposito: assim a assercao nao precisa de numero novo a cada tabela criada e
  -- continua valendo para sempre.
  perform teste_ok(
    (select count(*) = 0 from pg_tables where schemaname = 'public' and not rowsecurity),
    'nenhuma tabela do schema public esta sem RLS ativado');

  -- O plano escrevia este insert como subconsulta do FROM, o que o Postgres
  -- recusa (instrucao que modifica dados so entra numa consulta via WITH).
  -- Com "returning ... into" a assercao e a mesma: o codigo de barras tem que
  -- voltar com os zeros a esquerda, e o insert prova que o nome com acento e
  -- emoji e aceito.
  insert into produtos (codigo_barras, nome, preco_venda, estoque_atual)
  values ('0012345', 'DIPIRONA 500mg ção 🧪', 450, 10)
  returning codigo_barras into v_codigo_barras;

  perform teste_ok(
    v_codigo_barras = '0012345',
    'codigo de barras preserva zeros a esquerda e nome aceita acento e emoji');
end $$;
