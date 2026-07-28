import { registerRootComponent } from 'expo'
import { setPlatform } from '@core/ports'
import { mobilePlatform } from './src/platform/mobile'
import App from './App'

// 注入手机端平台实现，iOS / Android 共用（与桌面端 main.tsx 对称）
setPlatform(mobilePlatform)

registerRootComponent(App)
