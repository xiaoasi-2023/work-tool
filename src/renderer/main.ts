import { createApp, h } from 'vue'
import { createPinia } from 'pinia'
import { ElConfigProvider, ElLoading } from 'element-plus'
import { registerElementComponents } from './element-components'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import './style.css'
import './workspace.css'
import './utilities.css'
import App from './App.vue'

const app = createApp({ render: () => h(ElConfigProvider, { locale: zhCn }, () => h(App)) })
app.use(createPinia()).use(ElLoading)
registerElementComponents(app)
app.mount('#app')
