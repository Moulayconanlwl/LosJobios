import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { Dashboard } from './Dashboard'

const container = document.getElementById('root')
if (!container) throw new Error('Dashboard root element is missing.')

createRoot(container).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
)
