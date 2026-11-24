import type { App } from 'vue'
import { ElAlert, ElButton, ElCheckbox, ElDialog, ElDropdown, ElDropdownItem, ElDropdownMenu, ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElPagination, ElRadioButton, ElRadioGroup, ElSelect, ElTable, ElTableColumn, ElTag } from 'element-plus'

export const elementComponents = { ElAlert, ElButton, ElCheckbox, ElDialog, ElDropdown, ElDropdownItem, ElDropdownMenu, ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElPagination, ElRadioButton, ElRadioGroup, ElSelect, ElTable, ElTableColumn, ElTag }

export function registerElementComponents(app: App) {
  for (const [name, component] of Object.entries(elementComponents)) app.component(name, component)
}
