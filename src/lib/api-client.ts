let redirectingToLogin = false

function redirectToLoginAfterUnauthorized() {
  if (typeof window === 'undefined' || redirectingToLogin) return

  redirectingToLogin = true
  void fetch('/api/auth/logout', { method: 'POST' })
    .catch(() => null)
    .finally(() => {
      window.location.assign('/login')
    })
}

export async function readApiError(response: Response): Promise<string> {
  if (response.status === 401) {
    redirectToLoginAfterUnauthorized()
    return 'Your session has expired. Redirecting to sign in...'
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const data = await response.json()
      if (typeof data?.error === 'string' && data.error.trim()) return data.error
      if (typeof data?.message === 'string' && data.message.trim()) return data.message
    } catch {
      return `Request failed with status ${response.status}`
    }
  }

  try {
    const text = await response.text()
    if (text.trim()) return text.trim().slice(0, 300)
  } catch {
    // Fall through to the generic message.
  }

  return `Request failed with status ${response.status}`
}
