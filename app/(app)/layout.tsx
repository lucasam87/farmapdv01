import Link from 'next/link'
import { perfilAtual } from '@/lib/auth/perfil'
import { sair } from './actions'

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
      <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <p className="text-lg text-slate-800">
            Usuário sem perfil cadastrado. Fale com o responsável.
          </p>
          <form action={sair} className="mt-6">
            <button
              type="submit"
              className="rounded-lg bg-slate-800 px-6 py-3 text-base font-medium text-white hover:bg-slate-700"
            >
              Sair
            </button>
          </form>
        </div>
      </main>
    )
  }

  return (
    <div className="flex min-h-dvh bg-slate-50">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <p className="px-2 text-lg font-semibold text-slate-800">Farmácia</p>

        <nav className="mt-6 space-y-1">
          {MENU.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-3 py-2 text-base text-slate-700 hover:bg-slate-100"
            >
              {item.rotulo}
            </Link>
          ))}
        </nav>

        <form action={sair} className="mt-8 border-t border-slate-200 pt-4">
          <p className="px-1 text-xs text-slate-500">{perfil.nome}</p>
          <button
            type="submit"
            className="mt-2 w-full rounded-lg px-3 py-2 text-left text-base text-slate-600 hover:bg-slate-100"
          >
            Sair
          </button>
        </form>
      </aside>

      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
