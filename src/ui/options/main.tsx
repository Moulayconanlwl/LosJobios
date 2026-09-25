import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { Options } from './Options'

const container = document.getElementById('root')
if (!container) throw new Error('Options root element is missing.')

createRoot(container).render(
  <StrictMode>
    <Options />
  </StrictMode>,
)
