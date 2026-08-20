import { useLayoutEditHotkey } from '../../edit-mode'
import { ZoneEditor } from '../zone-editor'

import { TreeEditBar } from './edit-bar'

export function useSkuLayoutEditHotkey(): void {
  useLayoutEditHotkey(true)
}

export function SkuTreeEditBar() {
  return <TreeEditBar />
}

export function SkuZoneEditor() {
  return <ZoneEditor />
}
