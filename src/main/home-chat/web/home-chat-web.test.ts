import { describe, expect, it } from 'vitest'
import { htmlToText } from './home-chat-html-text'
import { parseDuckDuckGoResults, webFetch } from './home-chat-web'

const DDG_HTML = `
<div class="result results_links web-result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs%3Fa%3D1&amp;rut=x">Example <b>Docs</b></a>
  <a class="result__snippet" href="#">The &amp; official docs.</a>
</div>
<div class="result result--ad">
  <a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a>
</div>
<div class="result">
  <a class="result__a" href="https://second.test/">Second</a>
</div>`

describe('web tools', () => {
  it('parses DuckDuckGo HTML results, unwrapping redirects and skipping ads', () => {
    expect(parseDuckDuckGoResults(DDG_HTML, 5)).toEqual([
      {
        title: 'Example Docs',
        url: 'https://example.com/docs?a=1',
        snippet: 'The & official docs.'
      },
      { title: 'Second', url: 'https://second.test/', snippet: '' }
    ])
  })

  it('turns a page into readable text without scripts or navigation', () => {
    const page = htmlToText(
      '<html><head><title>Release &amp; notes</title><script>evil()</script></head><body><nav>Menu</nav><h2>v2</h2><p>See <a href="https://x.test/c">changes</a>.</p><ul><li>One</li><li>Two</li></ul></body></html>'
    )
    expect(page.title).toBe('Release & notes')
    expect(page.text).toBe('## v2\n\nSee changes (https://x.test/c).\n\n- One\n- Two')
  })

  it('fetches a page without any API key', async () => {
    const fetcher = (url: string): Promise<Response> =>
      Promise.resolve(
        new Response(`<title>Hi</title><p>Fetched ${url}</p>`, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
      )
    const page = await webFetch('https://a.test/page', fetcher)
    expect(page).toMatchObject({ status: 200, title: 'Hi', text: 'Fetched https://a.test/page' })
  })
})
