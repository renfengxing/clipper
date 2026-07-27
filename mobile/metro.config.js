const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

// 让 Metro 能读到仓库根下的 packages/core（共享逻辑）
const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [path.resolve(workspaceRoot, 'packages/core')]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')]
config.resolver.extraNodeModules = {
  '@core': path.resolve(workspaceRoot, 'packages/core/src')
}
module.exports = config
