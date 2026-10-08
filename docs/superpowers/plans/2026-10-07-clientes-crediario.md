# Clientes e crediário (Etapa 6) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O balcão cadastra cliente, vende no crediário, recebe pagamento parcial com o saldo caindo na hora, abre o WhatsApp com a cobrança pronta e importa os saldos devedores do sistema antigo sem risco de cobrar o dobro.

**Architecture:** Três RPCs novas (`receber_pagamento`, `cliente_salvar`, `importar_clientes`) concentram toda a escrita — a tela não calcula saldo nem grava lançamento. A leitura vem das views que já existem (`v_clientes_devedores`) mais consultas diretas a `crediario_lancamentos` para o extrato. A guarda contra dobrar a dívida é do **banco**, não da tela: o saldo importado é um lançamento `compra` marcado, e a RPC se recusa a lançar o segundo.

**Tech Stack:** Next 16 (App Router, Server Components + Server Actions), Supabase/Postgres 17 (RPC `security definer`, RLS, views), Vitest, Playwright, Tailwind v4. Python/openpyxl só para gerar a fixture `.xlsx` (como em `tests/fixtures/produtos.xlsx`).

**Spec:** `docs/superpowers/specs/2026-10-06-sistema-farmacia-design.md` — §5 (contrato de RPCs), §6 (views), §7.4 (RLS e "a restrição de papel não fica só na RLS"), §8.4 (regras do crediário), §9 (mensagens), §10 (interface), §13 Etapa 6 + §11.2 B2 (importação de cliente com saldo devedor inicial).

## Global Constraints

- Dinheiro é **inteiro em centavos**; a conversão para reais só em `lib/format.ts`. O erro de fator 100 já apareceu duas vezes neste projeto (spec §11 B3 e o PDV) — todo texto lido do usuário/planilha passa pelo parser de `lib/dinheiro.ts`.
- **Nunca gerar saldo credor** (spec §8.4): pagamento maior que a dívida é recusado.
- O **crediário nunca entra em `esperado_dinheiro`** (spec §6/§8.3); recebimento em **dinheiro** entra.
- `limite_credito = 0` significa **não faz crediário**, não ilimitado (spec §8.4).
- WhatsApp **só abre** `wa.me` com a mensagem pronta; nunca envia nada (spec §8.4).
- Toda RPC: `security definer`, `set search_path = public, pg_temp`, checagem de papel no início, mensagens em português (spec §5/§9).
- Comandos: `npm test` · `npm run test:sql [-- arquivo]` · `npm run test:e2e` · `npm run lint` · `npm run build` · `npm run migrar -- <arquivo>`.
- **Nunca rodar `test:sql` e `test:e2e` em paralelo** (mesmo banco de produção), e a suíte SQL não roda com caixa aberto.
- Nenhuma dependência nova. `middleware.ts` não existe aqui (é `proxy.ts`).

## Review Focus

O que a spec implica e nenhuma tarefa prova sozinha — cada linha já aponta o teste que a amarra:

1. **Reimportar o mesmo arquivo não pode dobrar a dívida.** O pior dano possível desta etapa é cobrar do cliente o dobro; o guarda é do banco (T2) e a prévia avisa quantos saldos foram ignorados (T6).
2. **Pagamento acima da dívida** (e dívida já zerada) é recusado com a mensagem da spec §9, nunca gera crédito (T1 SQL, T5 tela).
3. **Recebimento em dinheiro entra no caixa; crediário e cartão não** — `esperado_dinheiro` tem de subir só com dinheiro (T1 SQL).
4. **Atendente não mexe em limite nem em bloqueio** (nem cria cliente com limite > 0): é o caminho para liberar crédito de graça (T2 SQL com os dois papéis, T4/T6 telas).
5. **Valor ilegível ou negativo no recebimento** (`"abc"`, `"10.00"`, `"0"`) tem de virar mensagem em português, não erro de banco nem cobrança de 100× (T3 unitário, T5 tela).

---

### Task 1: `receber_pagamento` (migration 014) + caso SQL 090

**Files:**
- Create: `supabase/migrations/014_receber_pagamento.sql`
- Create: `tests/sql/casos/090_crediario.sql`

**Interfaces:**
- **Produces:** `receber_pagamento(p_cliente_id uuid, p_valor integer, p_forma text) returns jsonb` — dono e atendente. Devolve `{cliente_id, valor, saldo_apos}`.
  - Exige **caixa aberto**: sem sessão aberta recusa com a **mesma** mensagem da venda (`Abra o caixa para começar a vender.`, spec §8.4).
  - `p_forma` ∈ `dinheiro`, `pix`, `debito`, `credito` (`crediario` não é forma de receber).
  - `p_valor > 0`; `p_valor <= saldo devedor`, senão `O valor é maior que a dívida (R$ X).` (spec §9, com o valor formatado por `centavos_em_reais`, que já existe).
  - Grava **um** `crediario_lancamentos` (`tipo='pagamento'`, `venda_id = null`, `forma_pagamento = p_forma`, `usuario_id = auth.uid()`) e **um** `caixa_movimentos` (`tipo='recebimento_crediario'`, `forma = p_forma`, `valor` positivo) na sessão aberta mais recente — a mesma que `registrar_venda` escolhe (`where status='aberto' order by aberto_em desc limit 1`).
  - Cliente inexistente → `Cliente não encontrado.`; usuário sem perfil → `Usuário sem perfil cadastrado. Fale com o responsável.`
- **Consumes:** `crediario_lancamentos`, `caixa_sessoes`, `caixa_movimentos`, `clientes`, `perfis`, `centavos_em_reais` (`001_base.sql`).

- [ ] **Step 1: Escrever o caso SQL que falha**

`tests/sql/casos/090_crediario.sql`, um `do $$ ... $$` com o cenário dos helpers (`criar_usuario_teste` dono + atendente, `criar_cliente`, `criar_produto`, `criar_caixa_aberto`, `set_config('request.jwt.claims', ...)`) e estas asserções (todas escopadas por `cliente_id`/`venda_id` — o banco é o de produção):

```sql
-- caso 1: baixa parcial e o saldo cai
perform teste_ok((select saldo = 8000 from v_clientes_devedores where cliente_id = v_c1),
  'caso 1: pagamento de R$ 20,00 sobre dívida de R$ 100,00 deixa saldo de R$ 80,00');
perform teste_ok(((receber_pagamento(v_c1, 2000, 'dinheiro'))->>'saldo_apos')::int = 8000,
  'caso 1: a RPC devolve o saldo depois do pagamento');

-- caso 2: acima da dívida e recusado (spec 8.4: nunca gerar saldo credor)
perform teste_erro($$select receber_pagamento(v_c1, 900000, 'dinheiro')$$,
  'O valor é maior que a dívida', 'caso 2: acima da divida e recusado sem gerar credito');

-- caso 3: dinheiro entra no esperado da gaveta; pix NAO
perform teste_ok((select esperado_dinheiro = 10000 + 2000 from v_caixa_atual),
  'caso 3: recebimento em dinheiro entra em esperado_dinheiro');

-- caso 4: sem caixa aberto e recusado com a mensagem da venda (spec 8.4)
--   (fecha a sessao na mao, como o caso 4 de 020_cancelamento.sql faz)

-- caso 5: valor zero ou negativo e recusado
-- caso 6: forma 'crediario' e recusada
-- caso 7: atendente PODE receber (spec 5: dono, atendente)
-- caso 8: o pagamento vira uma linha em crediario_lancamentos com forma e usuario
```

**Antes de escrever:** leia `tests/sql/_helper.sql`. O helper de recusa é
`teste_erro(p_sql text, p_trecho text, p_nome text)` — ele **exige** que a exceção venha e que a
mensagem contenha o trecho (comparação sem maiúscula/minúscula). Use-o nos casos de recusa
(acima da dívida, valor zero, forma `crediario`, sem caixa aberto, atendente sem permissão), com
o trecho da mensagem da spec §9. Não invente outra forma.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:sql -- 090_crediario.sql`
Expected: `FALHOU ... function receber_pagamento(...) does not exist`, `0 OK, 1 FALHOU`.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/014_receber_pagamento.sql`. Detalhes que a assinatura não decide: o saldo é `select coalesce(sum(case when tipo='compra' then valor else -valor end), 0) from crediario_lancamentos where cliente_id = p_cliente_id` **com `for update` no cliente** (mesmo padrão do limite de crediário em `registrar_venda` — sem ele, dois recebimentos simultâneos leem o mesmo saldo); a sessão de caixa é a mais recente aberta; `revoke all ... from public, anon` + `grant execute ... to authenticated, service_role` (padrão das outras RPCs).

- [ ] **Step 4: Aplicar e ver passar**

Run: `npm run migrar -- 014_receber_pagamento.sql` → `1 de 1 migrations aplicadas`, HTTP 201.
Run: `npm run test:sql -- 090_crediario.sql` → todas `OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/014_receber_pagamento.sql tests/sql/casos/090_crediario.sql
git commit -m "receber_pagamento: baixa parcial no crediario com o caixa aberto"
```

---

### Task 2: `cliente_salvar` e `importar_clientes` (migration 015) + caso SQL 100

**Files:**
- Create: `supabase/migrations/015_clientes.sql`
- Create: `tests/sql/casos/100_clientes.sql`

**Interfaces:**
- **Produces:**
  - `cliente_salvar(p_id uuid, p_nome text, p_telefone text, p_cpf text, p_limite_credito integer, p_bloqueado boolean, p_observacao text, p_saldo_inicial integer) returns uuid` — dono e atendente.
    - `p_id` nulo = cadastro novo; com valor = edição (id inexistente → `Cliente não encontrado.`).
    - Nome vazio → `Escreva o nome do cliente.`; limite negativo → `O limite de crédito não pode ser negativo.`; CPF repetido (o `unique` do banco) → `Já existe um cliente com este CPF.`
    - **Atendente:** `p_limite_credito` diferente do valor gravado (ou `> 0` num cadastro novo) e `p_bloqueado` diferente do gravado → recusa `Só o dono pode mudar o limite de crédito.` (e, para bloqueio, `Só o dono pode bloquear um cliente.`); `p_saldo_inicial` diferente de zero → `Só o dono pode lançar saldo devedor.`
    - `p_saldo_inicial > 0` (só dono) grava um `crediario_lancamentos` `tipo='compra'`, `venda_id = null`, `observacao = 'Saldo importado do sistema antigo'` — **a mesma marca** da importação (interfaces abaixo).
  - `importar_clientes(p_linhas jsonb, p_atualizar_existentes boolean) returns jsonb` — **só dono**. Tudo-ou-nada, como `importar_produtos` (`008_importacao.sql`): uma linha inválida derruba o arquivo inteiro. Cada linha: `{nome, telefone, cpf, limite_credito, saldo}`.
    - **Casa por CPF** (o `unique` já existe). Linha **sem CPF é inválida** (motivo na prévia, T6): sem chave, reimportar duplicaria o cliente.
    - Cliente novo → insere com os campos da linha; existente + `p_atualizar_existentes` → atualiza nome/telefone/limite; existente sem a flag → conta como `ignorados`.
    - **Saldo:** insere `crediario_lancamentos` (`tipo='compra'`, `venda_id = null`, marcado) **só se o cliente ainda não tiver** um lançamento `tipo='compra'`, `venda_id is null` com a marca. Senão conta em `saldos_ignorados`. ← é a guarda contra dobrar a dívida.
    - Devolve `{criados, atualizados, ignorados, saldos_lancados, saldos_ignorados}`.
- **Consumes:** `clientes`, `crediario_lancamentos`, `perfis`; o padrão de `importar_produtos` (leia `supabase/migrations/008_importacao.sql` antes de escrever — inclusive a validação de `p_linhas` e o `raise` nomeando a linha).

- [ ] **Step 1: Escrever o caso SQL que falha**

`tests/sql/casos/100_clientes.sql`, com as asserções abaixo (uma `perform teste_ok` cada; cenário com dono, atendente, dois clientes e um caixa aberto quando precisar):

```sql
-- caso 1: cadastro pelo atendente nasce com limite 0
-- caso 2: atendente que tenta limite > 0 e recusado com a mensagem
perform teste_ok((select limite_credito = 0 from clientes where id = v_novo),
  'caso 1: cliente cadastrado por atendente nasce sem crediario');
-- caso 3: o dono muda o limite
-- caso 4: CPF repetido e recusado
-- caso 5: saldo inicial do dono vira lancamento marcado
perform teste_ok((select count(*) = 1 from crediario_lancamentos
                   where cliente_id = v_c1 and tipo = 'compra' and venda_id is null
                     and observacao = 'Saldo importado do sistema antigo'),
  'caso 5: saldo inicial do dono grava UM lancamento marcado como importado');

-- caso 6: A GUARDA. Reimportar o MESMO arquivo nao dobra a divida.
perform importar_clientes(v_linhas, true);
perform importar_clientes(v_linhas, true);
perform teste_ok((select count(*) = 1 from crediario_lancamentos
                   where cliente_id = v_c1 and tipo = 'compra' and venda_id is null),
  'caso 6: reimportar duas vezes deixa UM lancamento de saldo, nunca dois');
perform teste_ok(((importar_clientes(v_linhas, true))->>'saldos_ignorados')::int = 1,
  'caso 6: a segunda importacao conta o saldo como ignorado em vez de relancar');

-- caso 7: saldo inicial pela tela + importacao do mesmo cliente = um lancamento so
-- caso 8: linha sem CPF derruba o arquivo inteiro (tudo-ou-nada)
-- caso 9: atendente NAO importa (spec 5: importacao e do dono)
perform teste_ok((select count(*) = 0 from clientes where nome = 'CLIENTE DO ATENDENTE'),
  'caso 9: importacao recusada para atendente nao grava nada');
```

- [ ] **Step 2: Rodar e ver falhar**
Run: `npm run test:sql -- 100_clientes.sql` → `function cliente_salvar(...) does not exist`.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/015_clientes.sql` com as duas funções, os `revoke`/`grant` do padrão e o cabeçalho explicando que a marca do saldo importado é o que impede a dívida de dobrar.

- [ ] **Step 4: Aplicar e ver passar**
Run: `npm run migrar -- 015_clientes.sql` → HTTP 201, `1 de 1`.
Run: `npm run test:sql -- 100_clientes.sql` → todas `OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/015_clientes.sql tests/sql/casos/100_clientes.sql
git commit -m "clientes: cadastro com limite so do dono e saldo importado que nao dobra"
```

---

### Task 3: `app/(app)/clientes/validacao.ts` — validação pura

**Files:**
- Create: `app/(app)/clientes/validacao.ts`
- Test: `app/(app)/clientes/validacao.test.ts`

**Interfaces:**
- **Produces** (funções puras, sem Supabase/React):
  - `validarCliente(entrada: { nome: string; telefone: string; cpf: string; limite: string; saldoInicial: string }, ehDono: boolean): { ok: true; valores: { nome: string; telefone: string | null; cpf: string | null; limite: number; saldoInicial: number } } | { ok: false; mensagem: string }`
  - `validarRecebimento(valor: string, divida: number): { ok: true; centavos: number } | { ok: false; mensagem: string }`
  - `linkWhatsApp(telefone: string | null, nome: string, saldo: number): string | null` — `null` quando não há telefone; senão `https://wa.me/55<digitos>?text=<mensagem codificada>`.
  - `formatarTelefone(bruto: string): string | null`
- **Consumes:** `parsearCentavos` (`lib/dinheiro.ts`), `formatarMoeda` (`lib/format.ts`).

- [ ] **Step 1: Escrever os testes que falham**

`app/(app)/clientes/validacao.test.ts` (Vitest, `describe/it` em português, no estilo de `app/(app)/caixa/validacao.test.ts`):

```ts
// nome obrigatorio
expect(validarCliente({ ...vazio, nome: '  ' }, true)).toEqual({ ok: false, mensagem: 'Escreva o nome do cliente.' })
// limite: o erro de fator 100 (spec 11 B3) — "10.00" e DEZ REAIS, nao mil
expect(validarCliente({ ...vazio, nome: 'ANA', limite: '10.00' }, true).valores.limite).toBe(1000)
expect(validarCliente({ ...vazio, nome: 'ANA', limite: '-5' }, true)).toEqual({ ok: false, mensagem: 'O limite de crédito não pode ser negativo.' })
// atendente nao lanca saldo inicial
expect(validarCliente({ ...vazio, nome: 'ANA', saldoInicial: '50' }, false)).toEqual({ ok: false, mensagem: 'Só o dono pode lançar saldo devedor.' })
// CPF: 11 digitos ou vazio; telefone: 10 ou 11 digitos
expect(validarCliente({ ...vazio, nome: 'ANA', cpf: '123' }, true).ok).toBe(false)
expect(validarCliente({ ...vazio, nome: 'ANA', telefone: '(11) 91234-5678' }, true).valores.telefone).toBe('11912345678')

// recebimento: valor ilegivel, zero, negativo e acima da divida
expect(validarRecebimento('abc', 5000)).toEqual({ ok: false, mensagem: 'Valor inválido. Use, por exemplo, 20,00.' })
expect(validarRecebimento('0', 5000)).toEqual({ ok: false, mensagem: 'O valor do recebimento precisa ser maior que zero.' })
expect(validarRecebimento('60,00', 5000)).toEqual({ ok: false, mensagem: 'O valor é maior que a dívida (R$ 50,00).' })
expect(validarRecebimento('20,00', 5000)).toEqual({ ok: true, centavos: 2000 })

// whatsapp: so abre; sem telefone nao ha link
expect(linkWhatsApp(null, 'ANA', 5000)).toBeNull()
expect(linkWhatsApp('11912345678', 'ANA', 5000)).toBe(
  'https://wa.me/5511912345678?text=' + encodeURIComponent('Olá, ANA! Seu saldo na farmácia é R$ 50,00. Podemos acertar?'),
)
```

- [ ] **Step 2: Rodar e ver falhar** — `npm test -- validacao.test.ts` → `Failed to resolve import "./validacao"`.
- [ ] **Step 3: Implementar `validacao.ts`.** O limite e o saldo inicial usam `parsearCentavos` (nunca `Number` cru); CPF/telefone são normalizados para dígitos; `linkWhatsApp` recebe o saldo em centavos e formata com `formatarMoeda`.
- [ ] **Step 4: Rodar e ver passar** — `npm test -- validacao.test.ts` → PASS; `npm run lint` exit 0.
- [ ] **Step 5: Commit**

```bash
git add "app/(app)/clientes/validacao.ts" "app/(app)/clientes/validacao.test.ts"
git commit -m "clientes: validacao pura do cadastro, do recebimento e do link do WhatsApp"
```

---

### Task 4: `/clientes` — lista, cadastro e detalhe

**Files:**
- Create: `app/(app)/clientes/page.tsx` (lista + busca)
- Create: `app/(app)/clientes/actions.ts` (`salvarCliente`)
- Create: `app/(app)/clientes/formulario.tsx` (client, `useActionState`)
- Create: `app/(app)/clientes/novo/page.tsx`
- Create: `app/(app)/clientes/[id]/page.tsx` (dados, saldo, extrato, receber, WhatsApp)
- Create: `app/(app)/crediario/receber.tsx` (client, `useActionState`) — **criado aqui** e só consumido pela Task 5
- Create: `app/(app)/crediario/actions.ts` (`receberDoCliente`) — **criado aqui**; a regra de ordem: o detalhe do cliente já recebe pagamento, então o formulário nasce nesta tarefa e a Task 5 apenas o embute na lista

**Interfaces:**
- **Consumes:** `cliente_salvar`, `receber_pagamento` (T1/T2); `validarCliente`, `validarRecebimento`, `linkWhatsApp` (T3); `v_clientes_devedores`; `perfilAtual`; `formatarMoeda`, `formatarDataHora`.
- **Produces:** `salvarCliente(_anterior, formData)` **e** `receberDoCliente(_anterior, formData)`, ambos com `Resultado = { ok: true; mensagem: string } | { ok: false; mensagem: string }` (o mesmo tipo de `caixa/actions.ts`); o componente `Receber({ clienteId, nome, saldo })` com `data-testid="receber-<cliente_id>"`; rotas `/clientes`, `/clientes/novo`, `/clientes/[id]?editar=1`; `data-testid` = `busca-cliente`, `linha-cliente`, `saldo-cliente`, `ok`, `erro`.

- [ ] **Step 1: A lista e a busca.** `/clientes` lê `clientes` (`id, nome, telefone, cpf, limite_credito, bloqueado`) com um filtro montado por **`filtroDeBuscaDeCliente(termo)`, uma função nova em `lib/postgrest.ts`**. A `filtroDeBuscaDeProduto` que existe lá casa `codigo_barras.eq` + `nome.ilike` — não serve. A nova monta as cláusulas **condicionalmente**, sempre passando por `valorDeFiltro` (o termo nunca entra cru no `.or()`; é a regra que `lib/postgrest.ts` existe para garantir):
  - `nome.ilike."%termo%"` sempre;
  - `telefone.ilike."%digitos%"` e `cpf.ilike."%digitos%"` **só quando o termo tiver dígitos** (`digitos = termo.replace(/\D/g, '')`), senão um termo só com letras viraria `%%` e a busca devolveria a lista inteira.
  Com teste de unidade em `lib/postgrest.test.ts` (o arquivo já existe) para os dois casos: termo com dígitos e termo só com letras.
  O saldo de cada um vem de `v_clientes_devedores` numa consulta só, casada por `cliente_id` no servidor (não faça N consultas).
- [ ] **Step 2: O formulário.** `formulario.tsx` é client component com `useActionState` (espelhe `caixa/tela.tsx`): nome, telefone, CPF, observação sempre visíveis; **limite de crédito, "bloqueado" e "saldo devedor inicial" só aparecem quando `ehDono`** — para o atendente a tela mostra `Limite e bloqueio são do dono.` em vez dos campos. O erro do banco vai cru para o recado (já é português).
- [ ] **Step 3: A action e o formulário de receber** (é aqui, não na Task 5 — o detalhe do cliente já recebe pagamento). `app/(app)/crediario/actions.ts` → `receberDoCliente`: `perfilAtual()` → sem perfil, `Usuário sem perfil cadastrado. Fale com o responsável.`; lê `saldo` do campo escondido **para validar o teto antes de ir ao banco** e `valor` do campo de texto; `validarRecebimento`; `supabase.rpc('receber_pagamento', { p_cliente_id, p_valor, p_forma })`; erro → mensagem crua; sucesso → `revalidatePath('/crediario')`, `revalidatePath('/clientes')`, `revalidatePath(\`/clientes/${id}\`)` e `{ ok: true, mensagem: 'Recebimento registrado.' }`. O saldo escondido vem da view e serve só para a validação da tela: **o teto de verdade é checado dentro da RPC** (T1). `app/(app)/crediario/receber.tsx` é o client component com `useActionState`, exposto como `Receber({ clienteId, nome, saldo })`.
- [ ] **Step 4: O detalhe.** `/clientes/[id]`: dados, saldo devedor grande no topo, extrato de `crediario_lancamentos` (data, tipo, valor, forma, observação — mais recente primeiro, limite 50), botão **Editar**, o `Receber` embutido e o link do WhatsApp (com a mensagem pronta; sem telefone, o link não aparece e a tela diz `Cliente sem telefone cadastrado.`).
- [ ] **Step 5: Verificar.** `npm run build` exit 0 com `ƒ /clientes`, `ƒ /clientes/novo`, `ƒ /clientes/[id]`; `npm run lint` exit 0.
- [ ] **Step 6: Commit**

```bash
git add "app/(app)/clientes" "app/(app)/crediario"
git commit -m "tela de clientes: busca, cadastro, detalhe com extrato e o limite protegido"
```

---

### Task 5: `/crediario` — quem deve, quanto e o recebimento no balcão

**Files:**
- Create: `app/(app)/crediario/page.tsx` (lista de devedores) — **só isto**: o formulário e a action de receber nascem na Task 4, porque o detalhe do cliente já precisa deles

**Interfaces:**
- **Consumes:** `receber_pagamento` (T1) via a action `receberDoCliente` **da Task 4**; `validarRecebimento`, `linkWhatsApp` (T3); `filtroDeBuscaDeCliente` (T4, em `lib/postgrest.ts`); o componente `Receber` (T4); `v_clientes_devedores` (`cliente_id, nome, telefone, limite_credito, saldo`).
- **Produces:** rota `/crediario?busca=<termo>`; `data-testid` = `linha-devedor`, `total-a-receber`; o mesmo `Receber` da Task 4 embutido em cada linha.

- [ ] **Step 1: A página.** Lista `v_clientes_devedores` (maior saldo primeiro, `limit 200`), filtro por nome/telefone dentro da própria view com `.or()` (mesmo helper da Task 4), o **total a receber** no topo (soma dos saldos listados) e, em cada linha, o saldo, o limite, o link do WhatsApp e o formulário de receber com o valor já focado.
- [ ] **Step 2: Verificar.** `npm run build` exit 0 com `ƒ /crediario`; `npm run lint` exit 0.
- [ ] **Step 3: Commit**

```bash
git add "app/(app)/crediario"
git commit -m "tela de crediario: quem deve, quanto e o recebimento sem sair da lista"
```

---

### Task 6: `/clientes/importar` — a planilha dos saldos devedores

**Files:**
- Create: `app/(app)/clientes/importar/analise.ts` + `analise.test.ts` (mapeamento puro da tabela)
- Create: `app/(app)/clientes/importar/actions.ts` (analisar + confirmar)
- Create: `app/(app)/clientes/importar/page.tsx`
- Create: `app/(app)/clientes/importar/formulario.tsx`
- Create: `tests/fixtures/clientes.xlsx` (gerado com o Python do projeto, como `tests/fixtures/produtos.xlsx`)

**Interfaces:**
- **Consumes:** `lerCsv`, `lerXlsx`, `detectarFormato` (`lib/csv.ts`, `lib/xlsx.ts`); `analisarClientes` (novo); `importar_clientes` (T2); `parsearCentavos`; `formatarMoeda`.
- **Produces:** `analisarClientes(tabela: Tabela): { linhas: LinhaCliente[]; somaLida: number; somaGravada: number; totalImpresso: number | null; faltando: string[]; semCpf: number; json: string }` com `LinhaCliente = { nome: string; telefone: string | null; cpf: string | null; limite_credito: number | null; saldo: number; erros: string[] }`; as actions `analisarClientesArquivo` e `confirmarImportacaoClientes` (mesmo contrato de `produtos/importar/actions.ts`), ambas **só dono** (`Só o dono pode importar clientes.`).
- Cabeçalhos aceitos (tolerantes, como em `lib/tabela.ts`): `nome`, `telefone`/`fone`, `cpf`, `limite`/`limite_credito`, `saldo`/`saldo_devedor`/`divida`.

- [ ] **Step 1: Testes da análise que falham.** `analise.test.ts` com uma tabela montada à mão (sem arquivo): colunas reconhecidas com acento e sem; `saldo` lido por `parsearCentavos`; **linha sem CPF conta em `semCpf` e é inválida**; soma lida × soma gravada; rodapé com TOTAL quando existir.
- [ ] **Step 2: Ver falhar e implementar `analise.ts`** (mesma forma de `lib/tabela.ts`: `analisarClientes` puro, sem I/O). Rodar até passar.
- [ ] **Step 3: A fixture.** Gere `tests/fixtures/clientes.xlsx` com openpyxl usando o Python do harness — `C:\Users\lucas\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe` (**openpyxl 3.1.5** está nesse ambiente; **não instale nada**): 4 clientes, um deles com o CPF repetido do anterior e um sem CPF, saldo com vírgula decimal pt-BR e um rodapé `TOTAL` com a soma. O script vai em `.superpowers/` (não versionado), como nas fixtures anteriores.
- [ ] **Step 4: As actions e a tela.** Duas viagens como em produtos (analisar sem gravar → conferência na tela → confirmar com o JSON no campo escondido): prévia com as 8 primeiras linhas, `Soma lida` × `Soma que será gravada` × `TOTAL impresso no arquivo` (quando houver), aviso destacado de **quantos clientes já têm saldo lançado** e serão ignorados, a contagem de `sem CPF`, e o checkbox "atualizar clientes que já existem" **viajando no estado** (o defeito `f120328` não pode se repetir). `/clientes/importar` é acessível pelo botão **Importar** em `/clientes`, visível só para o dono.
- [ ] **Step 5: Verificar.** `npm test` verde; `npm run build` exit 0 com `ƒ /clientes/importar`; `npm run lint` exit 0.
- [ ] **Step 6: Commit**

```bash
git add "app/(app)/clientes/importar" tests/fixtures/clientes.xlsx
git commit -m "importacao de clientes: previa com conferencia de saldos e a guarda contra dobrar a divida"
```

---

### Task 7: item 8 da revisão — busca de cliente no PDV

**Files:**
- Create: `app/api/clientes/busca/route.ts`
- Modify: `app/(app)/vendas/nova/page.tsx` (a lista de 500 clientes sai)
- Modify: `app/(app)/vendas/nova/pdv.tsx` (o `<select>` vira busca)

**Interfaces:**
- **Consumes:** `perfilAtual`, `criarClienteServidor`, `v_clientes_devedores`, o helper de filtro de `lib/postgrest.ts`.
- **Produces:** `GET /api/clientes/busca?termo=<2+ chars>` → `{ clientes: { id, nome, telefone, limite_credito, saldo }[] }` (401 sem sessão, 8 resultados, devedores primeiro); no PDV, `data-testid="busca-cliente"` e `data-testid="resultados-cliente"`.

- [ ] **Step 1: A rota**, espelhando `app/api/produtos/busca/route.ts` (mesmo contrato de erro e o mesmo cuidado com o termo no `.or()`): devolve o **saldo** de cada cliente porque o PDV precisa mostrar o limite disponível antes de fechar no crediário.
- [ ] **Step 2: O PDV.** Trocar o `<select>` por campo de busca com lista (mesmo comportamento do produto: setas + Enter, e o cliente escolhido aparece com nome e saldo). O crediário continua exigindo cliente escolhido, como hoje. Mantenha o rótulo `Cliente` no mesmo lugar para não quebrar `venda.spec.ts` (leia o teste antes: ele usa `getByLabel(/Cliente/)` e pega o `value` de uma `option` — **o e2e do crediário vai precisar mudar junto**, e é nesta tarefa).
- [ ] **Step 3: Verificar.** `npm run build` exit 0; `npm run lint` exit 0; `npm run test:e2e` → o `venda.spec.ts` atualizado continua verde.
- [ ] **Step 4: Commit**

```bash
git add app/api/clientes "app/(app)/vendas/nova" tests/e2e
git commit -m "PDV: buscar cliente em vez do select dos 500 primeiros (item 8 da revisao)"
```

---

### Task 8: e2e do crediário (Playwright)

**Files:**
- Create: `tests/e2e/crediario.spec.ts`
- Modify: `tests/e2e/global-setup.mjs` **só se** precisar de um cliente novo no cenário (hoje existe `CLIENTE E2E LIMITE BAIXO`, limite R$ 30,00, e o `limpar()` já apaga por nome)

**Interfaces:**
- **Consumes:** tudo das Tasks 4–7 (`data-testid`, rotas, rótulos) e o PDV (`F6` dinheiro, `F10` crediário, `Lançar`, `F2`).
- **Produces:** nada que outra tarefa use.

- [ ] **Step 1: Escrever os 6 testes**, no formato de `tests/e2e/historico.spec.ts` (login por `loadEnvFile`, `test.beforeEach`):

```ts
// (1) cadastrar cliente e ve-lo na lista
// (2) dono ve o campo de limite; a tela nao oferece limite para o atendente (asserte pelo
//     texto "Limite e bloqueio sao do dono." quando o usuario logado nao for dono — se o
//     cenario e2e so tem dono, asserte so o caminho do dono e DIGA isso no relatorio)
// (3) vender no crediario e o saldo aparecer em /crediario
// (4) receber parcial: o saldo cai pelo valor exato (R$ 30,00 -> R$ 20,00 com R$ 10,00)
// (5) receber acima da divida e recusado com "O valor é maior que a dívida"
// (6) o link do WhatsApp tem o numero com 55 e o texto com o saldo; cliente SEM telefone
//     nao mostra link (crie um cliente sem telefone para isso)
```

- [ ] **Step 2: Rodar** — `npm run test:e2e` → **20 passed** (14 de hoje + 6 novos), exit 0. Se o cenário atrapalhar, ajuste o **teste**; se de fato faltar um cliente, acrescente ao `global-setup.mjs` **e ao `limpar()`** (o teardown é o que mantém a suíte SQL rodando).
- [ ] **Step 3: Rodar a suíte SQL inteira** (depois do e2e, nunca em paralelo) — o esboço de casos acima dá **8 asserções em `090_crediario.sql` e 9 em `100_clientes.sql`** (250 + 17 = **267 OK**), mas o número real é o que você escreveu: **conte, diga o número e não ajuste teste para "chegar" numa contagem**.
- [ ] **Step 4: Commit**

```bash
git add tests/e2e/crediario.spec.ts tests/e2e/global-setup.mjs
git commit -m "e2e do crediario: cadastrar, vender, receber parcial e o WhatsApp"
```

---

### Task 9: Fechar a Etapa 6 no `PROGRESSO.md`

**Files:**
- Modify: `PROGRESSO.md` (cabeçalho "ONDE PARAMOS" + linha da Etapa 6 na tabela de Etapas)

**Interfaces:** nada consome.

- [ ] **Step 1: Rodar tudo em série** — `npm test`, `npm run test:sql`, `npm run lint`, `npm run build`, `npm run test:e2e`; cole cada número.
- [ ] **Step 2: Atualizar o `PROGRESSO.md`** — linha da Etapa 6 ✅ com as contagens reais, os hashes e o critério da spec ("saldo importado aparece, pagamento parcial atualiza, WhatsApp abre"); o cabeçalho apontando a **Etapa 7 (relatórios)** como próxima; e uma frase honesta sobre o que **não** virou teste nesta etapa (o item 8 da revisão sai da lista de pendências; o que ficar em aberto entra escrito).
- [ ] **Step 3: Commit**

```bash
git add PROGRESSO.md
git commit -m "etapa-6: clientes e crediario fechados, com a evidencia colada"
```

---

## Self-Review deste plano

- **Cobertura da spec:** §5 (as três RPCs novas e o papel de cada uma nas Tasks 1–2), §6 (`v_clientes_devedores` nas Tasks 4–5), §7.4 (a checagem de papel dentro da função, T2), §8.4 (teto, caixa obrigatório, WhatsApp que só abre, limite 0 = sem crediário — Tasks 1, 3, 5), §9 (mensagens literais nas Tasks 1–3), §10 (uma tarefa por tela; nada de tabela lotada), §13 Etapa 6 + B2 (importação com saldo devedor, T2/T6). O item 8 da revisão do PDV entra na T7.
- **Lacuna conhecida e declarada:** o critério "saldo importado aparece" só fica **provado com arquivo real** quando o Lucas tiver o arquivo do Nex — a fixture cobre o formato, como em produtos. A T9 tem de escrever isso, não esconder.
- **Tipos:** `Resultado` é o mesmo de `caixa/actions.ts`; `LinhaCliente`/`analisarClientes` (T6) são o único formato da importação; `validarCliente`/`validarRecebimento`/`linkWhatsApp` (T3) são consumidos por T4, T5 e T7 sem redefinição.
- **Riscos de sequência:** T4/T5 dependem de T1–T3; T6 depende de T2; T7 é independente das telas novas, mas toca `vendas/nova` e o `venda.spec.ts`, então vem **antes** do e2e (T8) para não escrever o teste duas vezes.
- **Proporção:** o plano diz as decisões (assinaturas, mensagens literais, guardas, testids), não transcreve os componentes.
