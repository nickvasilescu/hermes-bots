// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FirstRunSshForm, SSH_ONLY_IDENTITY_PATH } from './first-run-ssh-form'

function installDesktopMock() {
  const order: string[] = []

  const desktop = {
    sshResolveHost: vi.fn().mockResolvedValue({ user: 'cjm', port: 22, identityFile: '/wrong/key' }),
    testConnectionConfig: vi.fn().mockImplementation(async () => {
      order.push('test')

      return {
        reachable: true,
        sshError: null,
        host: 'cjm@100.100.10.20',
        remotePlatform: 'Linux/x86_64'
      }
    }),
    saveConnectionConfig: vi.fn().mockImplementation(async payload => {
      order.push('save')

      return payload
    }),
    applyConnectionConfig: vi.fn().mockImplementation(async payload => {
      order.push('apply')

      return payload
    })
  }

  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: desktop })

  return { desktop, order }
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('Mini Tailscale IP'), { target: { value: '100.100.10.20' } })
  fireEvent.change(screen.getByLabelText('SSH user'), { target: { value: 'cjm' } })
}

beforeEach(() => vi.restoreAllMocks())

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

describe('FirstRunSshForm', () => {
  it('exposes only the contained SSH fields with the fixed identity target', () => {
    installDesktopMock()
    render(<FirstRunSshForm />)

    expect(screen.getByText('Connect existing Hermes over SSH')).toBeTruthy()
    expect(screen.getByDisplayValue(SSH_ONLY_IDENTITY_PATH).getAttribute('readonly')).not.toBeNull()
    expect(screen.getByLabelText('Mini Tailscale IP')).toBeTruthy()
    expect(screen.getByLabelText('SSH user')).toBeTruthy()
    expect(screen.getByLabelText('SSH port')).toBeTruthy()
    expect(screen.getByLabelText('Remote Hermes path (optional)')).toBeTruthy()
    expect(screen.getByLabelText('Remote profile (optional)')).toBeTruthy()
    expect(screen.queryByText(/gateway url/i)).toBeNull()
    expect(screen.queryByText(/session token/i)).toBeNull()
    expect(screen.queryByText(/create cloud computer/i)).toBeNull()
    expect(screen.queryByText(/install.*locally/i)).toBeNull()
  })

  it('rejects DNS names and addresses outside the Tailscale ranges', () => {
    installDesktopMock()
    render(<FirstRunSshForm />)

    const host = screen.getByLabelText('Mini Tailscale IP')
    const test = screen.getByRole('button', { name: 'Verify SSH connection' })

    fireEvent.change(host, { target: { value: 'mini.tailnet.ts.net' } })
    expect((test as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(host, { target: { value: '192.168.1.5' } })
    expect((test as HTMLButtonElement).disabled).toBe(true)
  })

  it('tests, saves, then applies the unchanged SSH payload in that order', async () => {
    const { desktop, order } = installDesktopMock()
    render(<FirstRunSshForm />)
    fillRequiredFields()

    fireEvent.click(screen.getByRole('button', { name: 'Verify SSH connection' }))
    expect(await screen.findByText(/Verified cjm@100.100.10.20/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))

    await waitFor(() => expect(desktop.applyConnectionConfig).toHaveBeenCalledTimes(1))
    expect(order).toEqual(['test', 'save', 'apply'])
    expect(desktop.saveConnectionConfig).toHaveBeenCalledWith({
      mode: 'ssh',
      profile: null,
      sshHost: '100.100.10.20',
      sshUser: 'cjm',
      sshPort: 22,
      sshKeyPath: SSH_ONLY_IDENTITY_PATH,
      sshRemoteHermesPath: '',
      sshRemoteProfile: ''
    })
  })

  it('keeps the form populated and never applies when persistence fails', async () => {
    const { desktop, order } = installDesktopMock()
    desktop.saveConnectionConfig.mockRejectedValueOnce(new Error('connection.json is read-only'))
    render(<FirstRunSshForm />)
    fillRequiredFields()

    fireEvent.click(screen.getByRole('button', { name: 'Verify SSH connection' }))
    await screen.findByText(/Verified/)
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))

    expect((await screen.findByRole('alert')).textContent).toContain('connection.json is read-only')
    expect(order).toEqual(['test'])
    expect(desktop.applyConnectionConfig).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Mini Tailscale IP') as HTMLInputElement).value).toBe('100.100.10.20')
  })

  it('surfaces unknown and changed host keys as distinct operator-managed failures', async () => {
    const { desktop } = installDesktopMock()
    desktop.testConnectionConfig
      .mockResolvedValueOnce({ reachable: false, sshError: 'host-key-unknown' })
      .mockResolvedValueOnce({ reachable: false, sshError: 'host-key-changed' })

    render(<FirstRunSshForm />)
    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: 'Verify SSH connection' }))
    expect(await screen.findByText(/does not contain a key for this Mini/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Verify SSH connection' }))
    expect(await screen.findByText(/does not match the operator-verified key/)).toBeTruthy()
    expect(desktop.saveConnectionConfig).not.toHaveBeenCalled()
  })
})
