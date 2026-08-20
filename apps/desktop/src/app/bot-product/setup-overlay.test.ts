import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getGlobalModelInfo } from '@/hermes'
import { isSshOnlyProduct } from '@/lib/product'

import { BotSetupOverlay, createFirstBotProfile, formatBotSetupError } from './setup-overlay'

vi.mock('@/hermes', () => ({
  getGlobalModelInfo: vi.fn()
}))

vi.mock('@/lib/product', () => ({
  isBotProduct: () => true,
  isSshOnlyProduct: vi.fn(() => false)
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('first bot profile setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['openai-codex', 'gpt-5.6-sol'],
    ['xai-oauth', 'grok-4.6']
  ])('pins the connected %s model onto the created profile', async (provider, model) => {
    vi.mocked(getGlobalModelInfo).mockResolvedValue({ provider, model })
    const requestGateway = vi.fn().mockResolvedValue({})

    await expect(createFirstBotProfile('Research Assistant', requestGateway)).resolves.toEqual({
      model,
      name: 'research-assistant',
      provider
    })
    expect(requestGateway).toHaveBeenCalledWith('profiles.create', {
      name: 'research-assistant',
      description: 'Research Assistant',
      clone_from: null,
      no_skills: false,
      model,
      provider
    })
  })

  it('does not create an unpinned-model profile when model resolution fails', async () => {
    vi.mocked(getGlobalModelInfo).mockResolvedValue({ provider: '', model: '' })
    const requestGateway = vi.fn().mockResolvedValue({})

    await expect(createFirstBotProfile('Assistant', requestGateway)).rejects.toThrow(
      /connected GPT or Grok model could not be resolved/
    )
    expect(requestGateway).not.toHaveBeenCalled()
  })
})

describe('bot setup overlay', () => {
  it('does not expose cloud, provider, Composio, Orgo, or Tailscale setup in the SSH-only SKU', () => {
    vi.mocked(isSshOnlyProduct).mockReturnValueOnce(true)

    const { container } = render(
      createElement(BotSetupOverlay, {
        enabled: true,
        requestGateway: async <T>() => ({}) as T
      })
    )

    expect(container.innerHTML).toBe('')
    expect(screen.queryByPlaceholderText('Orgo API key')).toBeNull()
    expect(screen.queryByText(/Tailscale/i)).toBeNull()
    expect(screen.queryByText(/Composio/i)).toBeNull()
  })

  it('exports a skippable overlay component', () => {
    expect(typeof BotSetupOverlay).toBe('function')
  })

  it('shows animated, explanatory progress while the cloud computer is prepared', async () => {
    const provision = new Promise<never>(() => undefined)

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        orgoDesktop: {
          provision: vi.fn().mockReturnValue(provision),
          saveKey: vi.fn().mockResolvedValue({}),
          status: vi.fn().mockResolvedValue({ apiKeySet: false, computerId: '' })
        }
      }
    })

    const view = render(
      createElement(BotSetupOverlay, {
        enabled: true,
        requestGateway: async <T>() => {
          return {} as T
        }
      })
    )

    fireEvent.change(screen.getByPlaceholderText('Orgo API key'), { target: { value: 'orgo-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create cloud computer' }))

    const progress = await screen.findByRole('status')

    expect(within(progress).getByText('Preparing your cloud computer')).toBeTruthy()
    expect(within(progress).getByText(/This can take a few minutes/)).toBeTruthy()
    expect(view.container.querySelector('.animate-spin')).toBeTruthy()
    expect(screen.getByPlaceholderText('Orgo API key').getAttribute('disabled')).not.toBeNull()
  })

  it('turns Electron context cancellation into an actionable retry message', () => {
    expect(
      formatBotSetupError(
        new Error(
          "Error invoking remote method 'hermes:orgo-desktop:tailscale:begin': OrgoDesktopError: context canceled"
        ),
        'Fallback'
      )
    ).toBe(
      'Your cloud computer is ready, but the private connection took too long to start. Try “Authorize cloud computer” again.'
    )
  })

  it('never dumps raw Tailscale status JSON into the onboarding card', () => {
    const rawStatus = JSON.stringify({
      AuthURL: '',
      BackendState: 'NeedsLogin',
      Self: { PublicKey: `nodekey:${'0'.repeat(64)}` }
    })

    expect(formatBotSetupError(new Error(rawStatus.repeat(20)), 'Fallback')).toBe(
      'Tailscale is installed on the cloud computer, but it did not provide a sign-in link. Try authorizing again.'
    )
  })
})
