import ReactDOM from 'react-dom/client'
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
    <AuthProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>
  </BrowserRouter>
)
