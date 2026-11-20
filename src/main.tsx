import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// The landing page lives at "/" and the app at "/app". Each one is its own
// chunk, so visitors of the landing never download the app bundle.
const isApp = /^\/app(\/|$)/.test(window.location.pathname)
const Page = isApp ? lazy(() => import('./Root.tsx')) : lazy(() => import('./landing/LandingPage.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  </StrictMode>,
)
