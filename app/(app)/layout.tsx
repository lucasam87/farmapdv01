import Link from 'next/link'
import { perfilAtual } from '@/lib/auth/perfil'
import { sair } from './actions'
import { Atalhos } from './atalhos'
import { AlternadorTema } from './tema'

// As 9 entradas do menu. As telas por trás delas chegam nas etapas seguintes.
const MENU = [
  { href: '/vendas', rotulo: 'Vendas' },
  { href: '/vendas/nova', rotulo: 'Nova venda' },
  { href: '/produtos', rotulo: 'Produtos' },
  { href: '/estoque', rotulo: 'Estoque' },
  { href: '/clientes', rotulo: 'Clientes' },
  { href: '/crediario', rotulo: 'Crediário' },
  { href: '/caixa', rotulo: 'Caixa' },
  { href: '/relatorios', rotulo: 'Relatórios' },
  { href: '/agente', rotulo: 'Agente' },
]

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const perfil = await perfilAtual()

  // Segunda linha de defesa: o proxy já barra quem não tem sessão, mas quem
  // tem sessão e não tem perfil em `perfis` também não entra.
  if (!perfil) {
    return (
      <main className="relative flex min-h-dvh items-center justify-center bg-background p-6">
        {/* O alternador também aqui: esta tela é justamente onde cai quem tem conta
            mas ainda não tem perfil, e ela não tem menu nenhum. */}
        <div className="absolute right-4 top-4">
          <AlternadorTema compacto />
        </div>
        <div className="w-full max-w-md rounded-lg bg-card p-8 text-center shadow-sm">
          <p className="text-lg text-foreground">
            Usuário sem perfil cadastrado. Fale com o responsável.
          </p>
          <form action={sair} className="mt-6">
            <button
              type="submit"
              className="min-h-11 rounded-lg bg-primary px-6 text-base font-medium text-primary-foreground hover:opacity-90"
            >
              Sair
            </button>
          </form>
        </div>
      </main>
    )
  }

  return (
    <div className="flex min-h-dvh bg-background">
      {/* F3 abre a nova venda de qualquer tela (spec 10). */}
      <Atalhos />
      <aside className="w-56 shrink-0 border-r border-border bg-card p-4">
        <p className="px-2 text-lg font-semibold text-foreground">Farmácia</p>

        <nav className="mt-6 space-y-1">
          {MENU.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block min-h-11 rounded-lg px-3 py-2 text-base text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {item.rotulo}
            </Link>
          ))}
        </nav>

        <div className="mt-8 border-t border-border pt-4">
          <AlternadorTema />
          <p className="px-3 pt-4 text-xs text-muted-foreground">{perfil.nome}</p>
          <form action={sair}>
            <button
              type="submit"
              className="mt-2 flex min-h-11 w-full items-center rounded-lg px-3 text-left text-base text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Sair
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
