import { getMainHttpClient } from '../../network/http-client'
import type { HomeChatSearchProvider } from '../../../shared/home-chat/home-chat-types'
import { htmlToText, stripTags } from './home-chat-html-text'
import { isRecord } from '../home-chat-record-guard'

export type HomeChatWebConfig = {
  searchProvider: HomeChatSearchProvider
  searxngUrl: string
  apiKey: string | null
}

export type HomeChatSearchResult = { title: string; url: string; snippet: string }

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

const MAX_FETCH_BYTES = 5 * 1024 * 1024
const USER_AGENT = 'Mozilla/5.0 (compatible; SealAssistant/1.0)'

const defaultFetch: Fetcher = (url, init) => getMainHttpClient().fetch(url, init)

async function readCapped(response: Response): Promise<string> {
  if (!response.body) {
    return ''
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done || !value) {
      break
    }
    chunks.push(value)
    size += value.length
    if (size >= MAX_FETCH_BYTES) {
      await reader.cancel()
      break
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Duckduckgo's HTML endpoint wraps result links in a redirect carrying the target in uddg. */
export function parseDuckDuckGoResults(html: string, count: number): HomeChatSearchResult[] {
  const results: HomeChatSearchResult[] = []
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1)
  for (const block of blocks) {
    const link = block.match(
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    )
    if (!link) {
      continue
    }
    let url = link[1].replaceAll('&amp;', '&')
    const target = url.match(/[?&]uddg=([^&]+)/)?.[1]
    if (target) {
      url = decodeURIComponent(target)
    } else if (url.startsWith('//')) {
      url = `https:${url}`
    }
    if (url.includes('duckduckgo.com/y.js')) {
      continue
    }
    const snippet = block.match(
      /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(a|div|td)>/i
    )?.[1]
    results.push({ title: stripTags(link[2]), url, snippet: snippet ? stripTags(snippet) : '' })
    if (results.length >= count) {
      break
    }
  }
  return results
}

function records(value: unknown, key: string): Record<string, unknown>[] {
  const list = isRecord(value) ? value[key] : undefined
  return Array.isArray(list) ? list.filter(isRecord) : []
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export async function webSearch(
  query: string,
  count: number,
  config: HomeChatWebConfig,
  fetcher: Fetcher = defaultFetch
): Promise<HomeChatSearchResult[]> {
  const needsKey = config.searchProvider === 'brave' || config.searchProvider === 'tavily'
  if (needsKey && !config.apiKey) {
    throw new Error(
      `Web search with ${config.searchProvider} needs an API key in the assistant settings.`
    )
  }
  if (config.searchProvider === 'brave') {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`
    const response = await fetcher(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': String(config.apiKey) }
    })
    const body: unknown = await response.json()
    const web = isRecord(body) ? body.web : null
    return records(web, 'results').map((r) => ({
      title: text(r.title),
      url: text(r.url),
      snippet: stripTags(text(r.description))
    }))
  }
  if (config.searchProvider === 'tavily') {
    const response = await fetcher('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ query, max_results: count })
    })
    return records(await response.json(), 'results').map((r) => ({
      title: text(r.title),
      url: text(r.url),
      snippet: text(r.content)
    }))
  }
  if (config.searchProvider === 'searxng') {
    if (!config.searxngUrl.trim()) {
      throw new Error('Set the SearXNG URL in the assistant settings.')
    }
    const base = config.searxngUrl.trim().replace(/\/+$/, '')
    const response = await fetcher(`${base}/search?q=${encodeURIComponent(query)}&format=json`, {
      headers: { Accept: 'application/json' }
    })
    return records(await response.json(), 'results')
      .slice(0, count)
      .map((r) => ({ title: text(r.title), url: text(r.url), snippet: text(r.content) }))
  }
  const response = await fetcher(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }
    }
  )
  if (!response.ok) {
    throw new Error(`DuckDuckGo answered ${response.status}; configure another search provider.`)
  }
  return parseDuckDuckGoResults(await readCapped(response), count)
}

export type WebPage = {
  url: string
  status: number
  contentType: string
  title: string | null
  text: string
}

/** Fetch a URL as readable text; needs no key. */
export async function webFetch(url: string, fetcher: Fetcher = defaultFetch): Promise<WebPage> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be fetched.')
  }
  const response = await fetcher(parsed.toString(), {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json,text/plain,*/*' },
    signal: AbortSignal.timeout(30_000)
  })
  const contentType = response.headers.get('content-type') ?? ''
  const isText = /text\/|json|xml|javascript|yaml/i.test(contentType) || !contentType
  if (!isText) {
    const length = response.headers.get('content-length')
    await response.body?.cancel()
    return {
      url: response.url || url,
      status: response.status,
      contentType,
      title: null,
      text: `[binary content (${contentType}${length ? `, ${length} bytes` : ''}); download it with run_command and curl, then attach_file to show it]`
    }
  }
  const raw = await readCapped(response)
  const page = /html/i.test(contentType) ? htmlToText(raw) : { title: null, text: raw }
  return { url: response.url || url, status: response.status, contentType, ...page }
}
