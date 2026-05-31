import { useState, useSyncExternalStore } from 'react'
import { logoutAdmin } from './api/adminApi'
import ChatPage from './pages/ChatPage'
import AdminLoginPage from './pages/AdminLoginPage'
import AdminProductsPage from './pages/AdminProductsPage'
import AdminChipsPage from './pages/AdminChipsPage'

function App() {
  const path = useSyncExternalStore(subscribeToRouteChanges, getCurrentPath)
  const [adminToken, setAdminToken] = useState(
    () => sessionStorage.getItem('mistifyAdminToken') ?? '',
  )

  function handleLogout() {
    if (adminToken) {
      void logoutAdmin(adminToken).catch(() => undefined)
    }

    sessionStorage.removeItem('mistifyAdminToken')
    setAdminToken('')
    window.history.pushState({}, '', '/admin/login')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  if (path === '/admin/login') {
    return <AdminLoginPage onLogin={setAdminToken} />
  }

  if (path === '/admin/products') {
    if (!adminToken) {
      return <AdminLoginPage onLogin={setAdminToken} />
    }

    return <AdminProductsPage token={adminToken} onLogout={handleLogout} />
  }

  if (path === '/admin/chips') {
    if (!adminToken) {
      return <AdminLoginPage onLogin={setAdminToken} />
    }

    return <AdminChipsPage token={adminToken} onLogout={handleLogout} />
  }

  return <ChatPage />
}

export default App

function getCurrentPath() {
  return window.location.pathname
}

function subscribeToRouteChanges(onRouteChange: () => void) {
  window.addEventListener('popstate', onRouteChange)

  return () => window.removeEventListener('popstate', onRouteChange)
}
