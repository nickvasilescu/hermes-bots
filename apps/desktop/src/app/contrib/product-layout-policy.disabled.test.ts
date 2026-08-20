import { describe, expect, it } from 'vitest'

import { group } from '@/components/pane-shell/tree/model'

import {
  BOT_ROSTER_PANE_ID,
  CORE_SESSIONS_PANE_ALLOWED,
  LOCAL_CORE_PANES_ALLOWED,
  selectProductTree
} from './product-layout-policy.disabled'

describe('SSH product layout policy', () => {
  it('selects a registered core sessions pane instead of the full Bot roster', () => {
    const standard = group(['workspace'])
    const bot = group(['full-bot-roster'])
    const ssh = group(['sessions', 'workspace'])

    expect(BOT_ROSTER_PANE_ID).toBe('sessions')
    expect(CORE_SESSIONS_PANE_ALLOWED).toBe(true)
    expect(LOCAL_CORE_PANES_ALLOWED).toBe(false)
    expect(selectProductTree({ bot, ssh, standard })).toBe(ssh)
  })
})
