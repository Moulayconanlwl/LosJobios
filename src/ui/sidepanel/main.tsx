import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { SidePanel } from './SidePanel'

const container = document.getElementById('root')
if (!container) throw new Error('Side panel root element is missing.')

createRoot(container).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
)
