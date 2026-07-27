import { registerRootComponent } from 'expo'
import { setPlatform } from '@core/ports'
import { iosPlatform } from './src/platform/ios'
import App from './App'

// 注入 iOS 平台实现（与桌面端 main.tsx 对称）
setPlatform(iosPlatform)

registerRootComponent(App)
