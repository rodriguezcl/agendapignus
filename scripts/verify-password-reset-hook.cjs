/* Real React hook checks with deferred synthetic HTTP responses. No server data. */
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')

const bundle = buildSync({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {usePasswordResetRequests} from './features/auth/application/usePasswordResetRequests.js';
      function Harness(props) {
        const state = usePasswordResetRequests(props);
        window.hookState = state;
        return <output>{JSON.stringify({ids:state.requests.map(item => item.id),error:state.error})}</output>;
      }
      const root = createRoot(document.getElementById('root'));
      window.renderHook = props => root.render(<Harness {...props}/>);
      window.unmountHook = () => root.unmount();
      window.renderHook({enabled:true,accountKey:'account-a'});`,
    loader: 'jsx', resolveDir: path.resolve(__dirname, '../src')
  },
  bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent'
}).outputFiles[0].text

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => route.abort())
    await page.setContent('<div id="root"></div>')
    await page.evaluate(() => {
      window.pendingHttp = []
      window.fetch = (url, options = {}) => new Promise(resolve => {
        window.pendingHttp.push({url, method:options.method || 'GET', body:options.body, resolve})
      })
      window.replyHttp = (index, data, status = 200) => {
        const request = window.pendingHttp[index]
        if (!request || request.replied) throw new Error(`Unexpected reply: ${index}`)
        request.replied = true
        request.resolve(new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}}))
      }
    })
    await page.addScriptTag({content:bundle})
    const waitRequests = count => page.waitForFunction(expected => window.pendingHttp.length === expected, count)
    const state = () => page.locator('output').textContent().then(JSON.parse)
    const expectIds = async ids => {
      await page.waitForFunction(expected => document.querySelector('output')?.textContent === JSON.stringify({ids:expected,error:''}), ids)
      assert.deepEqual((await state()).ids, ids)
    }
    const reply = (index, data, status = 200) => page.evaluate(({index,data,status}) => window.replyHttp(index,data,status), {index,data,status})
    const read = () => page.evaluate(() => { window.hookState.refresh() })
    const requests = [
      {id:'request-a',email:'a@example.test'},
      {id:'request-b',email:'b@example.test'}
    ]

    await waitRequests(1)
    await page.evaluate(() => {
      window.hookState.refresh()
      window.hookState.refresh()
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    assert.equal(await page.evaluate(() => window.pendingHttp.length), 1, 'Concurrent refreshes share the in-flight GET')
    await reply(0, {requests})
    await expectIds(['request-a','request-b'])

    // A poll started before a successful DELETE must not resurrect the request.
    await read()
    await waitRequests(2)
    await page.evaluate(() => { window.hookState.resolve('request-a') })
    await waitRequests(3)
    assert.equal(await page.evaluate(() => window.pendingHttp[2].method), 'DELETE')
    assert.deepEqual(await page.evaluate(() => JSON.parse(window.pendingHttp[2].body)), {id:'request-a'})
    await reply(2, {success:true})
    await expectIds(['request-b'])
    await reply(1, {requests})
    // Flush promise continuations and React's scheduled render before asserting.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.deepEqual((await state()).ids, ['request-b'], 'A stale GET must not restore a resolved request')

    // A new read remains functional after the stale request is discarded.
    await read()
    await waitRequests(4)
    await reply(3, {requests:[requests[1]]})
    await expectIds(['request-b'])

    // Switching accounts clears state and ignores a prior account's late result.
    await read()
    await waitRequests(5)
    await page.evaluate(() => window.renderHook({enabled:true,accountKey:'account-b'}))
    await waitRequests(6)
    await expectIds([])
    await reply(5, {requests:[{id:'account-b-request',email:'b@example.test'}]})
    await expectIds(['account-b-request'])
    await reply(4, {requests:[{id:'account-a-private',email:'a@example.test'}]})
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.deepEqual((await state()).ids, ['account-b-request'], 'Previous account responses must not leak into the current account')

    // Removing authorization hides requests and stops refresh and DELETE calls.
    await page.evaluate(() => window.renderHook({enabled:false,accountKey:'account-b'}))
    await expectIds([])
    await page.evaluate(() => {
      window.hookState.refresh()
      window.hookState.resolve('account-b-request')
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    assert.equal(await page.evaluate(() => window.pendingHttp.length), 6, 'Disabled access must not perform any requests')
    await page.evaluate(() => window.unmountHook())
    console.log('Password reset hook: deduplicated refresh, GET/DELETE race, account isolation and disabled access passed.')
  } finally { await browser.close() }
})().catch(error => {console.error(error); process.exitCode = 1})
