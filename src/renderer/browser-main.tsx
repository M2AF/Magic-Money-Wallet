import { createRoot } from 'react-dom/client'
import { BrowserApp } from './BrowserApp'
import './index.css'

createRoot(document.getElementById('root')!).render(<BrowserApp />)
