import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { assertSshOnlyApiRequestAllowed } from './ssh-api-policy'

const allowed = [
  { path: '/api/status' },
  { path: '/api/model/info', method: 'GET' },
  { path: '/api/model/options?explicit_only=1' },
  { path: '/api/profiles' },
  { path: '/api/profiles/active' },
  { path: '/api/profiles/projects/tree?preview_limit=5' },
  { path: '/api/profiles/sessions?limit=40&profile=all' },
  {
    path: '/api/profiles/sessions/sidebar?recents_profile=all&recents_limit=20&cron_limit=50&messaging_limit=100'
  },
  { path: '/api/sessions?limit=40' },
  { path: '/api/sessions/search?q=needle' },
  { path: '/api/sessions/session-123' },
  { path: '/api/sessions/session-123/messages?limit=500' },
  { path: '/api/sessions/session-123', method: 'DELETE' },
  { path: '/api/sessions/session-123', method: 'PATCH', body: { archived: true } },
  { path: '/api/sessions/session-123', method: 'PATCH', body: { pinned: false } },
  { path: '/api/sessions/session-123', method: 'PATCH', body: { profile: 'work', title: 'Renamed' } }
]

test('SSH-only API policy permits the retained read and chat-session operations', () => {
  for (const request of allowed) {
    assert.doesNotThrow(() => assertSshOnlyApiRequestAllowed(request), JSON.stringify(request))
  }
})

const denied = [
  null,
  {},
  { path: '/api/status', method: 'POST' },
  { path: '/api/status', body: {} },
  { path: '/api/status', upload: { file: '/tmp/x' } },
  { path: '/api/status', upload: false },
  { path: '/api/status', profile: '../../root' },
  { path: '/api/status', timeoutMs: 1_800_001 },
  { path: '/api/status?verbose=1' },
  { path: '/api/model/options' },
  { path: '/api/model/options?refresh=1&include_unconfigured=1' },
  { path: '/api/model/options?explicit_only=1&explicit_only=1' },
  { path: '/api/model/options?explicit_only=1&unknown=1' },
  { path: '/api/sessions?full=1' },
  { path: '/api/sessions?limit=101' },
  { path: '/api/sessions?limit=40&limit=1' },
  { path: '/api/profiles/sessions?full=1' },
  { path: '/api/profiles/sessions?profile=../../root' },
  { path: '/api/profiles/projects/tree?preview_limit=5000' },
  { path: '/api/profiles/projects/tree?preview_limit=3&session_limit=100000' },
  { path: '/api/profiles/sessions/sidebar?recents_limit=20' },
  { path: '/api/sessions/search?q=needle&source=telegram' },
  { path: '/api/sessions/id?profile=default&full=1' },
  { path: '/api/sessions/id/messages?limit=501' },
  { path: '/api/config' },
  { path: '/api/config', method: 'PUT', body: { config: {} } },
  { path: '/api/config/env', method: 'POST', body: { key: 'TOKEN', value: 'secret' } },
  { path: '/api/provider/oauth/start', method: 'POST', body: {} },
  { path: '/api/mcp/servers', method: 'POST', body: {} },
  { path: '/api/browser/connect', method: 'POST', body: {} },
  { path: '/api/hermes/update/check' },
  { path: '/api/ops/doctor', method: 'POST', body: {} },
  { path: '/api/plugins/example/action', method: 'POST', body: {} },
  { path: '/api/profiles', method: 'POST', body: { name: 'new' } },
  { path: '/api/profiles/default', method: 'DELETE' },
  { path: '/api/sessions/id', method: 'PATCH', body: { token: 'secret' } },
  { path: '/api/sessions/id', method: 'PATCH', body: { archived: 'yes' } },
  { path: '/api/sessions/id', method: 'PATCH', body: { profile: '../../root', title: 'moved' } },
  { path: '/api/sessions/id?profile=default', method: 'PATCH', body: { title: 'moved' } },
  { path: '/api/sessions/id?profile=default', method: 'DELETE' },
  { path: '/api/sessions/id/messages', method: 'DELETE' },
  { path: '/api/unknown' },
  { path: '//evil.invalid/api/status' },
  { path: '/api/%2e%2e/config' },
  { path: '/api/sessions%2fid' },
  { path: '/api\\status' },
  { path: '/api/status#ignored' }
]

test('SSH-only API policy rejects configuration, credential, operational, upload, and unknown requests', () => {
  for (const request of denied) {
    assert.throws(
      () => assertSshOnlyApiRequestAllowed(request as any),
      /unavailable in the SSH-only client/,
      JSON.stringify(request)
    )
  }
})

test('main authorizes SSH REST requests before routing or backend side effects', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8')
  const handlerStart = source.indexOf("ipcMain.handle('hermes:api'")
  const handler = source.slice(handlerStart, source.indexOf("\nipcMain.handle('hermes:ambient:claim'", handlerStart))

  assert.notEqual(handlerStart, -1)
  const policyIndex = handler.indexOf('assertSshOnlyApiRequestAllowed(request)')

  assert.ok(policyIndex >= 0, 'SSH policy must be called by the generic REST handler')

  for (const sideEffect of [
    'interceptSessionRequestForRemote(request)',
    'prepareProfileDeleteRequest(request)',
    'ensureBackend(routeProfile)',
    'fetchJson(url',
    'fetchJsonViaOauthSession(url'
  ]) {
    const sideEffectIndex = handler.indexOf(sideEffect)

    assert.ok(sideEffectIndex > policyIndex, `${sideEffect} must run only after SSH authorization`)
  }
})
