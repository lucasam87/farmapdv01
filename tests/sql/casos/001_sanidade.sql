do $$
declare
  v_codigo_barras text;
begin
  perform teste_ok(
    (select count(*) = 10 from pg_tables where schemaname = 'public'),
    'existem 10 tabelas no schema public');
  perform teste_ok(
    (select count(*) = 10 from pg_tables where schemaname = 'public' and rowsecurity = true),
    'todas as 10 tabelas tem RLS ativado');

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
