import './kit'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import '@bartor-net/ui-kit/base.css'
import '@bartor-net/ui-kit/styles.css'
import App from './App'

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
