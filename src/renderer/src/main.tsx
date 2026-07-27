import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { setPlatform } from '@core/ports'
import { desktopPlatform } from './platform/desktop'

// 注入桌面平台实现（iOS 端会在自己的入口注入 iosPlatform）
setPlatform(desktopPlatform)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
