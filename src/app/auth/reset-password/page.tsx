'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  // Supabase がリセットリンクから戻ってきたとき PASSWORD_RECOVERY イベントが発火する
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('パスワードが一致しません')
      return
    }
    if (password.length < 6) {
      setError('パスワードは6文字以上で入力してください')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setMessage('パスワードを更新しました。ログインページへ移動します…')
      setTimeout(() => router.push('/auth/login'), 2000)
    }
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
          <p className="text-muted text-sm mt-1">新しいパスワードを設定</p>
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-xl p-8">
          {message ? (
            <p className="text-ok text-sm bg-ok/10 border border-ok/30 rounded-lg px-4 py-3 text-center">{message}</p>
          ) : !ready ? (
            <p className="text-muted text-sm text-center">リンクを確認中…</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-muted mb-1.5">新しいパスワード</label>
                <input
                  type="password" required value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 text-sm text-text outline-none focus:border-accent transition-colors"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1.5">パスワード（確認）</label>
                <input
                  type="password" required value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 text-sm text-text outline-none focus:border-accent transition-colors"
                  placeholder="••••••••"
                />
              </div>

              {error && <p className="text-ng text-xs bg-ng/10 border border-ng/30 rounded-lg px-3 py-2">{error}</p>}

              <button
                type="submit" disabled={loading}
                className="w-full py-2.5 bg-accent/15 border border-accent text-accent rounded-lg text-sm font-semibold hover:bg-accent/25 transition-colors disabled:opacity-50"
              >
                {loading ? '更新中…' : 'パスワードを更新する'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
