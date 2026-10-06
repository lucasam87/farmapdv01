'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * F3 abre a nova venda de qualquer tela (spec 10).
 *
 * O `preventDefault()` e obrigatorio: sem ele o Chrome trata F3 como "buscar na
 * pagina" e o atalho nao chega no sistema (trava C4 da spec).
 *
 * Decisao do Lucas: o atalho NAVEGA e perde o que estava digitado em outra tela,
 * igual ao sistema antigo. Uma tarefa por tela, sem estado escondido — o
 * formulario de produto so grava no botao, entao o risco e redigitar.
 */
export function Atalhos() {
  const router = useRouter()

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key !== 'F3') return
      evento.preventDefault()
      router.push('/vendas/nova')
    }

    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [router])

  return null
}
