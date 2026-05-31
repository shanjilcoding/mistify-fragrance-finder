import { useState } from 'react'
import type { FormEvent } from 'react'
import { loginAdmin } from '../api/adminApi'

type AdminLoginPageProps = {
  onLogin: (token: string) => void
}

function AdminLoginPage({ onLogin }: AdminLoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const response = await loginAdmin(username, password)
      sessionStorage.setItem('mistifyAdminToken', response.token)
      onLogin(response.token)
      window.history.pushState({}, '', '/admin/products')
      window.dispatchEvent(new PopStateEvent('popstate'))
    } catch {
      setError('Invalid admin credentials.')
    } finally {
      setIsSubmitting(false)
      setPassword('')
    }
  }

  return (
    <main className="admin-auth-shell">
      <section className="admin-auth-card" aria-label="Mistify admin sign in">
        <aside className="admin-auth-story" aria-hidden="true">
          <p className="admin-eyebrow">Operations Console</p>
          <h2>Catalog controls without the clutter.</h2>
          <div className="admin-auth-signal-grid">
            <span>Products</span>
            <span>Helper chips</span>
            <span>Curated picks</span>
          </div>
        </aside>
      <form className="admin-login-panel" onSubmit={handleSubmit}>
        <div className="admin-login-heading">
          <p className="admin-eyebrow">Mistify Admin</p>
          <h1>Admin Login</h1>
          <p className="admin-login-copy">
            Manage product mappings, public helper chips, and curated fragrance lists.
          </p>
        </div>
        <label htmlFor="admin-username">Username</label>
        <input
          id="admin-username"
          type="text"
          value={username}
          autoComplete="username"
          placeholder="Enter admin username"
          onChange={(event) => setUsername(event.target.value)}
        />
        <label htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          type="password"
          value={password}
          autoComplete="current-password"
          placeholder="Enter admin password"
          onChange={(event) => setPassword(event.target.value)}
        />
        {error ? <p className="admin-error">{error}</p> : null}
        <button type="submit" disabled={isSubmitting || !username || !password}>
          {isSubmitting ? 'Checking...' : 'Log In'}
        </button>
        <p className="admin-login-meta">Protected workspace · Session stored only in this browser tab.</p>
      </form>
      </section>
    </main>
  )
}

export default AdminLoginPage
