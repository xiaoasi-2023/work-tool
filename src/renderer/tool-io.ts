import { ElMessage } from 'element-plus'
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); ElMessage.success('已复制') }
  catch { ElMessage.error('复制失败，请选择文本手动复制') }
}
export function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function readTextFile(file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error('文本文件不能超过 5 MB')
  return (await file.text()).replace(/^\uFEFF/, '')
}
