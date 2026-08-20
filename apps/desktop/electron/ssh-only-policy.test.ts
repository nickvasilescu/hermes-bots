import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  assertSshOnlyConnectionMode,
  DESKTOP_CONNECTION_MODES,
  isSshOnlyConnectionMode,
  SSH_ONLY_CAPABILITY_NAMES,
  SSH_ONLY_HOST_KEY_POLICY,
  SSH_ONLY_IDENTITY_PATH,
  SSH_ONLY_KNOWN_HOSTS_PATH,
  SSH_ONLY_POLICY
} from './ssh-only-policy'

test('ssh-only policy explicitly denies every forbidden capability', () => {
  assert.deepEqual(
    Object.keys(SSH_ONLY_POLICY)
      .filter(key => (SSH_ONLY_CAPABILITY_NAMES as readonly string[]).includes(key))
      .sort(),
    [...SSH_ONLY_CAPABILITY_NAMES].sort()
  )

  for (const capability of SSH_ONLY_CAPABILITY_NAMES) {
    assert.equal(SSH_ONLY_POLICY[capability], false, capability)
  }
})

test('ssh is the only accepted connection mode', () => {
  assert.deepEqual(SSH_ONLY_POLICY.allowedConnectionModes, ['ssh'])

  for (const mode of DESKTOP_CONNECTION_MODES) {
    assert.equal(isSshOnlyConnectionMode(mode), mode === 'ssh')

    if (mode === 'ssh') {
      assert.doesNotThrow(() => assertSshOnlyConnectionMode(mode))
    } else {
      assert.throws(() => assertSshOnlyConnectionMode(mode), /forbidden by the bot-ssh-only product policy/)
    }
  }
})

test('ssh-only policy is immutable', () => {
  assert.equal(Object.isFrozen(SSH_ONLY_POLICY), true)
  assert.equal(Object.isFrozen(SSH_ONLY_POLICY.allowedConnectionModes), true)
})

test('ssh-only identity and host-key inputs use fixed contained paths', () => {
  assert.equal(SSH_ONLY_IDENTITY_PATH, '/run/korgo-ssh/identity')
  assert.equal(SSH_ONLY_KNOWN_HOSTS_PATH, '/run/korgo-ssh/known_hosts')
  assert.deepEqual(SSH_ONLY_HOST_KEY_POLICY, {
    strictHostKeyChecking: 'yes',
    userKnownHostsFile: SSH_ONLY_KNOWN_HOSTS_PATH,
    globalKnownHostsFile: '/dev/null',
    updateHostKeys: 'no'
  })
  assert.equal(Object.isFrozen(SSH_ONLY_HOST_KEY_POLICY), true)
})
