import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeTree } from './routeTree.gen.ts'
import './styles/app.css'

// A client-side app: the router renders the page in the browser, from the file routes in src/routes
// (src/routeTree.gen.ts, which the router's Vite plugin writes on `pnpm dev` and `pnpm build`).
const router = createRouter({ routeTree, scrollRestoration: true })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const container = document.getElementById('root')
if (!container) throw new Error('index.html must contain <div id="root"></div> for the app to render into')
createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
