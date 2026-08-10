import { Routes, Route, Outlet } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import Nav from './components/layout/Nav'

// Lazy-loaded pages (code splitting)
const Home = lazy(() => import('./pages/Home'))

function MainLayout() {
  return (
    <>
      <Nav />
      <Suspense fallback={<div style={{ padding: '4rem', textAlign: 'center', color: 'var(--stone)' }}>Chargement...</div>}>
        <Outlet />
      </Suspense>
    </>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/" element={<Home />} />
      </Route>
    </Routes>
  )
}
