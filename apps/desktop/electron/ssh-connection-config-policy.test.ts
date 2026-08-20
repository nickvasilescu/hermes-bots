import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  coerceSshOnlyDesktopConnectionConfig,
  sanitizeSshOnlyDesktopConnectionConfig
} from './ssh-connection-config-policy'

const credentialFields = [
  'cloudOrg',
  'remoteAuthMode',
  'remoteOauthConnected',
  'remoteTokenPlainText',
  'remoteTokenPreview',
  'remoteTokenSet',
  'remoteUrl',
  'secureTokenStorage'
]

test('SSH renderer sanitizer returns only SSH connection fields without reading the adopted token', () => {
  const remote = {
    mode: 'ssh',
    host: '100.100.10.20',
    user: 'hermes',
    port: 22,
    keyPath: '/run/korgo-ssh/identity',
    remoteHermesPath: '/opt/hermes',
    remoteProfile: 'default',
    get token(): never {
      throw new Error('SSH sanitizer must not inspect the adopted gateway token')
    }
  }

  const result = sanitizeSshOnlyDesktopConnectionConfig({ mode: 'ssh', remote })

  assert.deepEqual(result, {
    mode: 'ssh',
    profile: null,
    sshHost: '100.100.10.20',
    sshUser: 'hermes',
    sshPort: null,
    sshKeyPath: '/run/korgo-ssh/identity',
    sshRemoteHermesPath: '/opt/hermes',
    sshRemoteProfile: 'default',
    envOverride: false
  })

  for (const field of credentialFields) {
    assert.equal(Object.hasOwn(result, field), false, field)
  }
})

test('SSH coercion branches before reading renderer-supplied remote credential fields', () => {
  const reads: PropertyKey[] = []

  const input = new Proxy(
    {
      mode: 'ssh',
      profile: null,
      sshHost: '100.100.10.20',
      sshUser: 'hermes'
    },
    {
      get(target, property, receiver) {
        reads.push(property)

        if (String(property).startsWith('remote') || property === 'allowPlainTextToken' || property === 'cloudOrg') {
          throw new Error(`credential field read: ${String(property)}`)
        }

        return Reflect.get(target, property, receiver)
      }
    }
  )

  const result = coerceSshOnlyDesktopConnectionConfig(input, { mode: 'local', remote: {} }, value => ({
    mode: 'ssh',
    host: value.sshHost,
    user: value.sshUser
  }))

  assert.equal(result.mode, 'ssh')
  assert.equal(result.remote.host, '100.100.10.20')
  assert.equal(
    reads.some(value => String(value).startsWith('remote')),
    false
  )
})

test('SSH coercion rejects every non-SSH mode before credential processing', () => {
  for (const mode of ['local', 'remote', 'cloud', '']) {
    assert.throws(
      () =>
        coerceSshOnlyDesktopConnectionConfig({ mode, remoteToken: 'sentinel' }, { mode: 'local', remote: {} }, () => {
          throw new Error('builder must not run')
        }),
      /forbidden by the bot-ssh-only product policy/
    )
  }
})
