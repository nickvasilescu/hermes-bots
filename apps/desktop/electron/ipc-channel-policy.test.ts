import assert from 'node:assert/strict'

import { test } from 'vitest'

import { GATEWAY_PROXY_CHANNELS, registerGatewayProxy } from './gateway-proxy'
import { IPC_CHANNEL_POLICY, PRIMARY_ONLY_IPC_PRIVILEGES, RENDERER_ORIGINATED_IPC_CHANNELS } from './ipc-channel-policy'
import { createAuthorizedIpc, type IpcChannelPrivilege, type IpcChannelRule } from './ipc-policy'
import { IpcTrustRegistry, type WindowCapability } from './ipc-trust'

const FORBIDDEN_FOR_SECONDARY = new Set<IpcChannelPrivilege>(PRIMARY_ONLY_IPC_PRIVILEGES)

function rule(channel: string): IpcChannelRule {
  const value = IPC_CHANNEL_POLICY[channel]
  assert.ok(value && !Array.isArray(value), `missing rich policy rule for ${channel}`)

  return value as IpcChannelRule
}

test('inventory classifies every exact renderer entry point without wildcard grants', () => {
  assert.equal(RENDERER_ORIGINATED_IPC_CHANNELS.length, 167)
  assert.equal(
    RENDERER_ORIGINATED_IPC_CHANNELS.some(channel => channel.includes('*')),
    false
  )

  const rules = RENDERER_ORIGINATED_IPC_CHANNELS.map(rule)
  assert.equal(rules.filter(item => item.kind === 'handle').length, 144)
  assert.equal(rules.filter(item => item.kind === 'on').length, 23)
  assert.equal(
    rules.every(item => item.capabilities.length > 0),
    true
  )
})

test('secondary windows have no host-impact capability grants', () => {
  const secondary: WindowCapability[] = ['session', 'hud', 'quick-entry', 'pet-overlay']

  for (const channel of RENDERER_ORIGINATED_IPC_CHANNELS) {
    const item = rule(channel)

    if (FORBIDDEN_FOR_SECONDARY.has(item.privilege)) {
      assert.deepEqual(item.capabilities, ['primary'], channel)
    }

    for (const capability of secondary) {
      if (item.privilege === 'filesystem' || item.privilege === 'git' || item.privilege === 'terminal') {
        assert.equal(item.capabilities.includes(capability), false, `${channel} grants ${capability}`)
      }
    }
  }
})

test('auxiliary surfaces receive only their exact local controls', () => {
  assert.deepEqual(rule('hermes:quick-entry:submit').capabilities, ['quick-entry'])
  assert.deepEqual(rule('hermes:quick-entry:dismiss').capabilities, ['quick-entry'])
  assert.deepEqual(rule('hermes:pet-overlay:set-bounds').capabilities, ['pet-overlay'])
  assert.deepEqual(rule('hermes:pet-overlay:control').capabilities, ['pet-overlay'])
  assert.deepEqual(rule('hermes:hud:move-by').capabilities, ['hud'])
  assert.deepEqual(rule('hermes:hud:session').capabilities, ['hud'])

  for (const channel of ['hermes:quick-entry:state', 'hermes:pet-overlay:state']) {
    assert.equal(rule(channel).capabilities.includes('quick-entry'), false, channel)
    assert.equal(rule(channel).capabilities.includes('pet-overlay'), false, channel)
  }
})

test('gateway proxy uses the authorized facade and participates in completeness accounting', () => {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const listeners = new Map<string, (...args: any[]) => unknown>()

  const authorized = createAuthorizedIpc({
    ipcMain: {
      handle: (channel, listener) => handlers.set(channel, listener),
      on: (channel, listener) => listeners.set(channel, listener)
    },
    isTrustedRendererUrl: () => true,
    policy: IPC_CHANNEL_POLICY,
    registry: new IpcTrustRegistry()
  })

  registerGatewayProxy({
    ipc: authorized,
    resolveUrl: async () => 'ws://127.0.0.1:9119/api/ws'
  })

  for (const channel of RENDERER_ORIGINATED_IPC_CHANNELS) {
    if (
      channel === GATEWAY_PROXY_CHANNELS.start ||
      channel === GATEWAY_PROXY_CHANNELS.send ||
      channel === GATEWAY_PROXY_CHANNELS.close
    ) {
      continue
    }

    const item = rule(channel)
    authorized[item.kind](channel, () => undefined)
  }

  assert.doesNotThrow(() => authorized.assertComplete())
  assert.equal(authorized.registrationSnapshot().length, RENDERER_ORIGINATED_IPC_CHANNELS.length)
  assert.equal(handlers.has(GATEWAY_PROXY_CHANNELS.start), true)
  assert.equal(listeners.has(GATEWAY_PROXY_CHANNELS.send), true)
  assert.equal(listeners.has(GATEWAY_PROXY_CHANNELS.close), true)
  assert.equal(RENDERER_ORIGINATED_IPC_CHANNELS.includes(GATEWAY_PROXY_CHANNELS.event), false)
})
