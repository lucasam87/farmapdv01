// Stub VAZIO do pacote `server-only`, usado so pelo Vitest (ver o alias em
// `vitest.config.ts`).
//
// POR QUE ISTO EXISTE. O `server-only` NAO esta instalado e o plano proibe
// instalar dependencia. O Next nao precisa do pacote: ele implementa
// `import 'server-only'` no proprio compilador (`node_modules/next/types/global.d.ts`
// declara o modulo, e `next-env.d.ts` referencia `types="next"`), entao a rota
// compila, type-checa e builda sem o pacote existir. O Vitest, porem, e um
// bundler de verdade: ele resolve os imports e nao conhece esse alias do
// compilador. Sem um modulo para resolver, qualquer teste que importe um modulo
// server-only morre em "Failed to resolve import 'server-only'" — antes mesmo de
// rodar o primeiro caso.
//
// A propria documentacao do Next manda fazer exatamente isto no Jest
// (`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`,
// secao "Preventing environment poisoning"): o import de `server-only` existe
// para o BUILDER barrar o uso no navegador, e o teste de unidade so precisa que
// ele resolva para alguma coisa. O arquivo nao exporta nada de proposito: e um
// efeito colateral que nao faz nada.
export {}
