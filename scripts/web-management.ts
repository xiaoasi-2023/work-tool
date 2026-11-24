import path from 'node:path'
import type { Plugin } from 'vite'
import { createWebManagementMiddleware } from '../src/main/web-management'
import { createWebWebsitesMiddleware } from '../src/main/web-websites'

export function webManagementPlugin(): Plugin {
  let directory: string
  return {
    name: 'workbench-web-management',
    configResolved(config) { directory = path.resolve(config.root, '.runtime/browser-data') },
    configureServer(server) { server.middlewares.use(createWebManagementMiddleware(directory)); server.middlewares.use(createWebWebsitesMiddleware(directory)) },
    configurePreviewServer(server) { server.middlewares.use(createWebManagementMiddleware(directory)); server.middlewares.use(createWebWebsitesMiddleware(directory)) }
  }
}
