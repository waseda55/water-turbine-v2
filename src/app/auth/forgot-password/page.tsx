'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError(null); setMessage(null)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/reset-password`,
    })

    if (error) {
      setError(error.message)
    } else {
      setMessage('パスワードリセット用のメールを送信しました。メールをご確認ください。')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-accent to-accent2 text-3xl mb-4">
            ⚙️
          </div>
          <h1 className="text-2xl font-bold text-accent tracking-wide">水車選定ツール</h1>
          <p className="text-muted text-sm mt-1">パスワードをお忘れの方</p>
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-xl p-8">
          {message ? (
            <div className="text-center space-y-4">
              <p className="text-ok text-sm bg-ok/10 border border-ok/30 rounded-lg px-4 py-3">{message}</p>
              <Link
                href="/auth/login"
                className="block text-xs text-muted hover:text-accent transition-colors"
              >
                ← ログインページに戻る
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted mb-5">
                登録済みのメールアドレスを入力してください。パスワードリセット用のリンクをお送りします。
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs text-muted mb-1.5">メールアドレス</label>
                  <input
                    type="email" required value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 text-sm text-text outline-none focus:border-accent transition-colors"
                    placeholder="you@example.com"
                  />
                </div>

                {error && <p className="text-ng text-xs bg-ng/10 border border-ng/30 rounded-lg px-3 py-2">{error}</p>}

                <button
                  type="submit" disabled={loading}
                  className="w-full py-2.5 bg-accent/15 border border-accent text-accent rounded-lg text-sm font-semibold hover:bg-accent/25 transition-colors disabled:opacity-50"
                >
                  {loading ? '送信中…' : 'リセットメールを送る'}
                </button>
              </form>

              <div className="mt-4 text-center">
                <Link
                  href="/auth/login"
                  className="text-xs text-muted hover:text-accent transition-colors"
                >
                  ← ログインページに戻る
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
