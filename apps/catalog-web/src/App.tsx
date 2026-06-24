import { useSyncExternalStore } from 'react'
import CatalogPage from './pages/CatalogPage'
import CatalogBestSellersPage from './pages/CatalogBestSellersPage'
import CatalogBrandsPage from './pages/CatalogBrandsPage'
import CatalogBrandPage from './pages/CatalogBrandPage'
import CatalogFragrancePage from './pages/CatalogFragrancePage'

function App() {
  const path = useSyncExternalStore(subscribeToRouteChanges, getCurrentPath)

  if (path === '/' || path === '/catalog') {
    return <CatalogPage />
  }

  if (path === '/catalog/best-sellers') {
    return <CatalogBestSellersPage />
  }

  if (path === '/catalog/brands') {
    return <CatalogBrandsPage />
  }

  if (path.startsWith('/catalog/brands/')) {
    return <CatalogBrandPage />
  }

  if (path.startsWith('/catalog/fragrances/')) {
    return <CatalogFragrancePage />
  }

  return <CatalogPage />
}

export default App

function getCurrentPath() {
  return window.location.pathname
}

function subscribeToRouteChanges(onRouteChange: () => void) {
  window.addEventListener('popstate', onRouteChange)

  return () => window.removeEventListener('popstate', onRouteChange)
}
