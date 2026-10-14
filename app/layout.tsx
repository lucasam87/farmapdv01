import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LaM Vendas",
  description: "Sistema de gestão da farmácia",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `suppressHydrationWarning` é necessário: o script abaixo põe a classe `dark`
    // no <html> ANTES de o React hidratar, então o DOM não bate com o HTML do
    // servidor só nesse atributo. É o preço de não piscar o tema errado.
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/*
          TEMA ANTES DA PRIMEIRA PINTURA. Este script roda de forma síncrona, antes
          de qualquer pixel, e é o que evita o clarão branco em quem escolheu o
          escuro. Só a escolha EXPLÍCITA liga o escuro: o padrão continua claro, e
          não seguimos o tema do sistema de propósito (ver `globals.css`).

          O `try` não é decorativo: `localStorage` lança em modo privado e com
          cookie bloqueado, e uma exceção aqui deixaria a página sem pintar.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('tema')==='escuro'){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
