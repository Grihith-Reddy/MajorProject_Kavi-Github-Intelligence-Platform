import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import { BrowserRouter } from 'react-router-dom'

import App from './app/App'
import { AuthProvider } from './features/auth/AuthProvider'
import { watchSystemTheme } from './features/theme/theme'
import { ToastProvider } from './features/toast/ToastProvider'
import './styles/index.css'
import './styles/kavi-system.css'

watchSystemTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </MotionConfig>
  </BrowserRouter>
)
