'use client'

import { useCallback, useSyncExternalStore } from 'react'

// Alternador de tema. A escolha vive no `localStorage` (chave `tema`) e a classe
// `dark` no <html> — quem a aplica ANTES da primeira pintura é o script do
// `app/layout.tsx`, para não piscar o tema errado.
//
// Use SOMENTE as classes de token (`bg-muted`, `text-muted-foreground`, `outline-ring`):
// com cor fixa do Tailwind este botão ficaria ilegível no escuro, que é exatamente
// o problema que a camada de tokens resolve.
const CHAVE = 'tema'

function IconeSol() {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function IconeLua() {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

/**
 * A escolha do tema NÃO é estado do React: ela vive no `localStorage` e como classe
 * no <html>, e é o script do `app/layout.tsx` quem a aplica antes da primeira
 * pintura. Ler isso com `useState` + `useEffect` funcionaria, mas o linter do
 * projeto está certo em recusar: `setState` dentro de efeito dispara render em
 * cascata. `useSyncExternalStore` é a ferramenta feita para ler valor externo — e o
 * observador abaixo mantém o rótulo em dia se outra aba (ou o próprio script)
 * trocar a classe.
 */
function assinar(aoMudar: () => void) {
  const observador = new MutationObserver(aoMudar)
  observador.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observador.disconnect()
}

function lerDoDom() {
  return document.documentElement.classList.contains('dark')
}

export function AlternadorTema() {
  // No servidor não há DOM nem `localStorage`, então o palpite é o claro — que é o
  // padrão do sistema. Quem escolheu o escuro vê o rótulo corrigir na hidratação;
  // a COR, essa, já veio certa do script, sem piscar.
  const escuro = useSyncExternalStore(assinar, lerDoDom, () => false)

  const alternar = useCallback(() => {
    const proximo = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', proximo)
    try {
      localStorage.setItem(CHAVE, proximo ? 'escuro' : 'claro')
    } catch {
      // Sem `localStorage` (modo privado, cookie bloqueado) a escolha vale só
      // nesta página. Não é motivo para o botão falhar.
    }
  }, [])

  // O rótulo diz a AÇÃO, não o estado: "Tema escuro" é o que acontece ao clicar.
  // Cor + ícone + texto, nunca só um deles (princípio 4 do DESIGN-PDV-FARMACIA).
  const rotulo = escuro ? 'Tema claro' : 'Tema escuro'

  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={escuro}
      // `min-h-11` = 44 px, o alvo mínimo do princípio 8.
      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {escuro ? <IconeSol /> : <IconeLua />}
      {rotulo}
    </button>
  )
}
