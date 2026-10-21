import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/jetbrains-mono/400.css'
import './styles/app.css'
import App from './App'
import { runProof } from './audio/proof'
import { encodeWav } from './audio/wav'

// Exposed for the browser test suite: the same functions the proof panel uses.
;(window as unknown as { orbit: unknown }).orbit = { runProof, encodeWav }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
