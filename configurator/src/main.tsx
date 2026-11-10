import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { detectPlatform } from './platform/detect'
import { AppProvider } from './state/store'
import { App } from './ui/App'
import { Unsupported } from './ui/OpenScreen'

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')

const platform = detectPlatform(window)

createRoot(root).render(
  <StrictMode>
    {'unsupported' in platform ? (
      <Unsupported message={platform.unsupported} />
    ) : (
      // App calls actions.restore() when it mounts.
      <AppProvider platform={platform}>
        <App />
      </AppProvider>
    )}
  </StrictMode>,
)
