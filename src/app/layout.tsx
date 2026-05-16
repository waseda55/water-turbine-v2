import type { Metadata } from 'next'
import { Space_Grotesk, JetBrains_Mono, Noto_Sans_JP } from 'next/font/google'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-space-grotesk',
})
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-jetbrains-mono',
})
const noto = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-noto',
})

export const metadata: Metadata = {
  title: '水車選定ツール',
  description: '計算式・パラメータ・判定ロジック — HPP Design 比較検証版',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} ${noto.variable}`}>
      <body className="bg-bg text-text antialiased">{children}</body>
    </html>
  )
}
