import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { requireGroupingPreviewBackends } from './firebase/groupingPreviewConfig.js'
import { initializeProductionGroupingRemoteConfig } from './firebase/productionRemoteConfig.js'

const root = createRoot(document.getElementById('root'))

try {
  await requireGroupingPreviewBackends(import.meta.env)
  await initializeProductionGroupingRemoteConfig()
  const { default: App } = await import('./App.jsx')
  root.render(
    // <StrictMode>
      <App />
    // </StrictMode>,
  )
} catch (error) {
  console.error(error)
  root.render(
    <StrictMode>
      <main className="preview-startup-blocked" role="alert">
        <h1>Preview startup blocked</h1>
        <p>{error.message}</p>
        <p>Start both local Firebase emulators and reload this page.</p>
      </main>
    </StrictMode>,
  )
}
