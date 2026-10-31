import { createApp, h } from 'vue'
import { createPinia } from 'pinia'
import { ElAlert, ElButton, ElCheckbox, ElConfigProvider, ElDialog, ElInput, ElLoading, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElTable, ElTableColumn, ElTag } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'

const app = createApp({ render: () => h(ElConfigProvider, { locale: zhCn }, () => h(App)) })
app.use(createPinia()).use(ElLoading)
const components = { ElAlert, ElButton, ElCheckbox, ElDialog, ElInput, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElTable, ElTableColumn, ElTag }
for (const [name, component] of Object.entries(components)) app.component(name, component)
app.mount('#app')
