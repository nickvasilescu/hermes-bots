import type { ComponentProps } from 'react'

interface SkillsViewProps extends ComponentProps<'section'> {
  setStatusbarItemGroup?: unknown
}

export function SkillsView({ setStatusbarItemGroup: _setStatusbarItemGroup, ...props }: SkillsViewProps) {
  return <section {...props} />
}
