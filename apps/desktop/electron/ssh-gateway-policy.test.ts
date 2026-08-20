import assert from 'node:assert/strict'

import { test } from 'vitest'

import { assertSshOnlyGatewayProxyDataAllowed } from './ssh-gateway-policy'

const request = (method: string, params: Record<string, unknown> = {}) =>
  JSON.stringify({ id: 'renderer-1', jsonrpc: '2.0', method, params })

test('SSH gateway policy permits bounded chat and session requests', () => {
  const allowed = [
    request('session.create', { cols: 96, cwd: '/srv/work', source: 'desktop' }),
    request('session.create', { profile: 'work', source: 'desktop' }),
    request('session.resume', { cols: 96, omit_messages: true, session_id: 'stored-1', source: 'desktop' }),
    request('complete.path', { session_id: 'runtime-1', word: '@file:src/' }),
    request('session.interrupt', { session_id: 'runtime-1' }),
    request('session.active_list'),
    request('session.context_breakdown', { session_id: 'runtime-1' }),
    request('session.cwd.set', { cwd: '/srv/work', session_id: 'runtime-1' }),
    request('session.compress', { focus_topic: 'current implementation', session_id: 'runtime-1' }),
    request('session.status', { session_id: 'runtime-1' }),
    request('commands.catalog', { session_id: 'runtime-1' }),
    request('approval.respond', { choice: 'once', session_id: 'runtime-1' }),
    request('model.options', { explicit_only: true, session_id: 'runtime-1' }),
    request('profiles.get_asset', { asset: 'avatar', name: 'default' }),
    request('prompt.submit', { session_id: 'runtime-1', text: 'hello' }),
    request('config.get', { key: 'project' }),
    request('config.set', { key: 'reasoning', session_id: 'runtime-1', value: 'high' }),
    request('config.set', { key: 'fast', session_id: 'runtime-1', value: 'fast' }),
    request('config.set', { key: 'model', session_id: 'runtime-1', value: 'model --provider provider --session' }),
    request('image.attach_bytes', { content_base64: 'AA==', filename: 'image.png', session_id: 'runtime-1' }),
    request('file.attach', {
      data_url: 'data:text/plain;base64,SGk=',
      name: 'note.txt',
      path: '',
      session_id: 'runtime-1'
    })
  ]

  for (const frame of allowed) {
    assert.doesNotThrow(() => assertSshOnlyGatewayProxyDataAllowed('gateway', frame), frame)
  }
})

test('SSH gateway policy rejects direct Mini configuration and host-impacting methods', () => {
  for (const method of [
    'billing.charge',
    'browser.manage',
    'cli.exec',
    'command.dispatch',
    'cron.manage',
    'mcp.setup.respond',
    'model.save_key',
    'plugins.manage',
    'profiles.configure',
    'shell.exec',
    'skills.manage',
    'slash.exec',
    'subscription.change',
    'tools.configure'
  ]) {
    assert.throws(() => assertSshOnlyGatewayProxyDataAllowed('gateway', request(method)), /unavailable/, method)
  }
})

test('SSH gateway policy rejects credential-shaped, malformed, binary, and over-broad safe-method params', () => {
  const denied = [
    request('config.get', { key: 'approvals.mode' }),
    request('config.set', { key: 'model.api_key', session_id: 'runtime-1', value: 'secret' }),
    request('config.set', { key: 'reasoning', value: 'high' }),
    request('config.set', { key: 'model', session_id: 'runtime-1', value: 'model --provider provider --global' }),
    request('config.set', { key: 'model', session_id: 'runtime-1', value: 'model —provider provider —session' }),
    request('prompt.submit', { remoteToken: 'secret', session_id: 'runtime-1', text: 'hello' }),
    request('session.create', { api_key: 'secret' }),
    request('session.create', { cols: 96, tools: ['shell'] }),
    request('session.create', { cols: 96, source: 'telegram' }),
    request('session.create', { profile: '../../.ssh', source: 'desktop' }),
    request('session.create', { profile: '/etc', source: 'desktop' }),
    request('session.create', { profile: { name: 'work' }, source: 'desktop' }),
    request('session.create', { profile: 'root', source: 'desktop' }),
    request('session.resume', { session_id: 'stored-1', unknown: true }),
    request('session.resume', { profile: '../../.ssh', session_id: 'stored-1', source: 'desktop' }),
    request('session.resume', { profile: 'tmp', session_id: 'stored-1', source: 'desktop' }),
    request('session.resume', { session_id: 'stored-1', source: 'telegram' }),
    request('session.resume', { session_id: 'stored-1' }),
    request('session.active_list', { current_session_id: 'runtime-1' }),
    request('session.context_breakdown', { include_messages: true, session_id: 'runtime-1' }),
    request('session.cwd.set', { cwd: 'relative/path', session_id: 'runtime-1' }),
    request('session.cwd.set', { cwd: '/srv/work\u0000/escape', session_id: 'runtime-1' }),
    request('session.compress', { focus_topic: '', session_id: 'runtime-1' }),
    request('session.compress', { focus_topic: 'x'.repeat(4097), session_id: 'runtime-1' }),
    request('commands.catalog', { session_id: '', unknown: true }),
    request('complete.path', { cwd: '/etc', session_id: 'runtime-1', word: '@file:passwd' }),
    request('complete.path', { session_id: 'runtime-1', word: '@plugin:secret' }),
    request('complete.path', { session_id: 'runtime-1', word: '@file:/etc/passwd' }),
    request('complete.path', { session_id: 'runtime-1', word: '@file:../secret' }),
    request('approval.respond', { choice: 'always', session_id: 'runtime-1' }),
    request('approval.respond', { all: true, choice: 'once', session_id: 'runtime-1' }),
    request('model.options', { explicit_only: true, refresh: true }),
    request('model.options', { include_unconfigured: true }),
    request('profiles.get_asset', { asset: '../SOUL.md', name: 'default' }),
    request('file.attach', {
      data_url: 'data:text/plain;base64,SGk=',
      name: 'host',
      path: '/etc/passwd',
      session_id: 'runtime-1'
    }),
    JSON.stringify({ id: 'renderer-1', jsonrpc: '2.0', method: 'prompt.submit', params: {}, extra: true }),
    '{bad json'
  ]

  for (const frame of denied) {
    assert.throws(() => assertSshOnlyGatewayProxyDataAllowed('gateway', frame), /unavailable/, frame)
  }

  assert.throws(() => assertSshOnlyGatewayProxyDataAllowed('gateway', new Uint8Array([1, 2, 3])), /unavailable/)
  assert.throws(() => assertSshOnlyGatewayProxyDataAllowed('plugin', request('prompt.submit')), /unavailable/)
})

test('SSH voice proxy permits only bounded text and finish frames', () => {
  assert.doesNotThrow(() => assertSshOnlyGatewayProxyDataAllowed('voice', JSON.stringify({ text: 'hello' })))
  assert.doesNotThrow(() => assertSshOnlyGatewayProxyDataAllowed('voice', JSON.stringify({ done: true })))
  assert.throws(
    () => assertSshOnlyGatewayProxyDataAllowed('voice', JSON.stringify({ text: 'hello', token: 'secret' })),
    /unavailable/
  )
  assert.throws(() => assertSshOnlyGatewayProxyDataAllowed('voice', new Uint8Array([1, 2, 3])), /unavailable/)
})
