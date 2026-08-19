import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from '@/state/theme-context'
import { TalkModeProvider } from '@/state/talk-mode-context'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TalkModeProvider>
        <App />
      </TalkModeProvider>
    </ThemeProvider>
  </StrictMode>,
)
