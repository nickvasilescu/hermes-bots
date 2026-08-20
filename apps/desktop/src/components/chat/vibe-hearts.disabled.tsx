import type { CSSProperties } from 'react'

import { createParticleEmitter, ParticleField, type ParticleFieldConfig } from '@/components/particles/particle-field'

export const COMPOSER_HEART_CONFIG: Partial<ParticleFieldConfig> = {
  count: 12,
  size: [6, 13],
  rise: [6.75, 15.75],
  duration: [320, 700]
}

const emitter = createParticleEmitter()

const HEART_GLYPH = (
  <svg fill="none" shapeRendering="crispEdges" viewBox="0 0 14 12" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M13.2 0v5.65714h-1.8857v1.88572H9.42857v1.88571H7.54286v1.88573H5.65714V9.42857H3.77143V7.54286H1.88571V5.65714H0V0h5.65714v1.88571h1.88572V0z"
      fill="currentColor"
    />
  </svg>
)

export const playVibeHearts = (count?: number) => emitter.burst(count)
export const burstVibeHearts = playVibeHearts

export function HeartField({
  config,
  className,
  style
}: {
  config?: Partial<ParticleFieldConfig>
  className?: string
  style?: CSSProperties
}) {
  return (
    <ParticleField
      className={className}
      colors={['#ff9ec4']}
      config={config}
      emitter={emitter}
      glyph={HEART_GLYPH}
      style={style}
    />
  )
}

export function PetHeartField(): null {
  return null
}
