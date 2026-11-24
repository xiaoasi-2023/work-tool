import { validateWebsitesState, type WebsitesApi, type WebsitesMutation, type WebsitesState } from './websites'

export function createWebsitesWebClient(fetcher: typeof fetch): WebsitesApi {
  async function request(url: string, body?: WebsitesMutation): Promise<WebsitesState> {
    let response: Response
    try { response = await fetcher(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined) }
    catch { throw new Error('无法连接本地网站服务，请确认浏览器调试服务已启动') }
    let data: any
    try { data = await response.json() } catch { throw new Error('本地网站服务返回格式无效，请重新启动调试服务') }
    if (!response.ok) throw new Error(data.error || '网站操作失败')
    return validateWebsitesState(data)
  }
  return { read: () => request('/api/websites'), mutate: body => request('/api/websites/mutate', body), open: async id => {
    for (let attempt = 0; ; attempt++) {
      const state = await request('/api/websites')
      try { return await request('/api/websites/mutate', { revision: state.revision, command: { type: 'visit', id } }) }
      catch (error) { if (attempt >= 1 || !(error as Error).message.includes('数据已更新')) throw error }
    }
  } }
}
