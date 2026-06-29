'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { Mail, TrendingUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { PRODUCT_NAME } from '@/lib/brand'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function resend() {
    if (!email) {
      setError('Email address is missing')
      return
    }
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const supabase = createClient()
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (resendError) {
        setError(resendError.message)
        return
      }
      setMessage('Verification email sent. Please check your inbox.')
    } catch {
      setError('Failed to resend verification email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-[440px] space-y-6">
        <div className="flex items-center gap-3 justify-center">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <TrendingUp size={20} className="text-white" />
          </div>
          <span className="text-slate-900 font-bold text-xl">{PRODUCT_NAME}</span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            <Mail size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Verify your email</h1>
            <p className="text-slate-500 text-sm mt-2">
              We sent a verification link to{' '}
              <span className="font-medium text-slate-700">{email || 'your email address'}</span>.
              Please confirm your email before signing in.
            </p>
          </div>

          {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}
          {message && <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm">{message}</div>}

          <button
            type="button"
            onClick={() => void resend()}
            disabled={loading || !email}
            className="w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}
          >
            {loading ? 'Sending…' : 'Resend verification email'}
          </button>

          <p className="text-sm text-slate-500">
            <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-800">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <VerifyEmailContent />
    </Suspense>
  )
}
