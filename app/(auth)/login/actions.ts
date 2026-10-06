'use server'

import { redirect } from 'next/navigation'
import { criarClienteServidor } from '@/lib/supabase/server'

export async function entrar(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const senha = String(formData.get('senha') ?? '')

  if (!email || !senha) {
    redirect('/login?erro=dados')
  }

  const supabase = await criarClienteServidor()
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  })

  // Nunca mostrar a mensagem crua do Supabase: ela diz se o e-mail existe.
  if (error) {
    redirect('/login?erro=credenciais')
  }

  redirect('/')
}
