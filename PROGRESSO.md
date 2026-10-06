# PROGRESSO — Sistema de Gestão para Farmácia

Este arquivo é o registro de andamento. **Regra: uma etapa só vira ✅ com a
evidência colada** (o comando que rodou e o resultado que apareceu). Sem
evidência, fica 🟡.

Legenda: ⬜ pendente · 🟡 em andamento · ✅ concluída com evidência · ⛔ bloqueada

| # | Etapa | Status | Evidência | Data |
|---|---|---|---|---|
| 0 | Decisões e ambiente | ✅ | Next 16.3.8 instalado, versões travadas no `package.json`, `PROGRESSO.md` criado; commits `498a53d`, `80a7f5d`; `npm run build` → Compiled successfully | 06/10/2026 |
| 1 | Base + login | 🟡 | Código pronto (commits `1e52cf3`, `a6ab961`, `5f03fda`); `npm test` 12/12, `npm run build` exit 0 com `ƒ /` e `ƒ /login`, `npm run lint` exit 0. **Falta a verificação manual do login** (bloqueada no projeto Supabase) | 06/10/2026 |
| 2 | Banco + funções | ⬜ | — | — |
| 3 | Produtos e estoque | ⬜ | — | — |
| 4 | PDV | ⬜ | — | — |
| 5 | Histórico de vendas | ⬜ | — | — |
| 6 | Clientes e crediário | ⬜ | — | — |
| 7 | Relatórios | ⬜ | — | — |
| 8 | Agente de IA | ⬜ | — | — |
| 9 | Publicar na Vercel | ⬜ | — | — |
| 10 | Migração de dados | ⬜ | — | — |
| 11 | Uso paralelo e corte | ⬜ | — | — |

## Bloqueio atual

**O que falta para a Etapa 1 fechar:** o projeto Supabase criado (região
`sa-east-1`) e o `.env.local` preenchido. Depois disso a ordem é: migration 001
(Tarefa 5) → criar o usuário e a linha em `perfis` → verificação manual do login
(Tarefa 4, Step 4) → Etapa 1 vira ✅.

## Etapas 0–2 em detalhe (Plano 1)

Plano: `docs/superpowers/plans/2026-10-06-fundacao-login-banco.md`

| Tarefa | Entrega | Status |
|---|---|---|
| 1 | Scaffold Next 16 com versões travadas + `PROGRESSO.md` | ✅ |
| 2 | `lib/format.ts` (moeda e data) com testes | ✅ 7/7 |
| 3 | Clients Supabase, `proxy.ts`, `perfilAtual` | ✅ 12/12 |
| 4 | Login, logout e menu de 9 entradas | 🟡 código pronto; verificação manual pendente |
| 5 | Migration 001: 10 tabelas, constraints e RLS | 🟡 aplicada e verificada; falta o primeiro perfil | 06/10/2026 |
| 6 | Runner de testes SQL (transação + rollback) | ⬜ bloqueada |
| 7 | `registrar_venda` | ⬜ bloqueada |
| 8 | Teste de concorrência | ⬜ bloqueada |
| 9 | `cancelar_venda` | ⬜ bloqueada |
| 10 | Funções de caixa | ⬜ bloqueada |
| 11 | Views de leitura + fuso de São Paulo | ⬜ bloqueada |

## Versões travadas

Registrado em 06/10/2026, a partir de `package.json` e do que está instalado em
`node_modules`. Todas as dependências estão em **versão exata** (sem `^` e sem
`latest`); o `package-lock.json` é commitado e é ele que fixa a árvore inteira.

| Pacote | Versão |
|---|---|
| Node.js | 24.19.0 |
| npm | 11.17.0 |
| next | 16.3.8 |
| react | 19.2.8 |
| react-dom | 19.2.8 |
| typescript | 5.9.3 |
| tailwindcss | 4.3.3 |
| @tailwindcss/postcss | 4.3.3 |
| @supabase/supabase-js | 2.117.2 |
| @supabase/ssr | 0.12.7 |
| vitest | 5.0.3 |
| pg | 8.23.1 |
| dotenv | 18.0.5 |
| eslint | 9.39.5 |
| eslint-config-next | 16.3.8 |
| @types/node | 24.19.1 |
| @types/react | 19.3.0 |
| @types/react-dom | 19.3.0 |

## Riscos conhecidos do ambiente

- **5 vulnerabilidades de severidade alta** em `npm audit`, todas na toolchain de
  lint (`braces` → `micromatch` → `fast-glob` → `@next/eslint-plugin-next` →
  `eslint-config-next`). São **dependências de desenvolvimento**: não entram no
  bundle nem rodam em produção. Sem correção não-destrutiva disponível
  (`npm audit fix` não resolve; `--force` quebraria a árvore). Reavaliar quando o
  Next publicar correção.
- **npm 11 bloqueia install scripts por padrão**: `unrs-resolver@1.12.2` teve o
  `postinstall` bloqueado. O `npm run build` passa mesmo assim. Se o `npm run
  lint` falhar por isso, rodar `npm approve-scripts unrs-resolver`.
- O scaffolder recusou a pasta `PROJETO 1` como nome de pacote (espaço e
  maiúsculas). O projeto foi gerado em pasta temporária e movido para a raiz; o
  campo `name` do `package.json` é `farmacia`.
