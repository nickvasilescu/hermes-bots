import { useStore } from '@nanostores/react'

import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Palette } from '@/lib/icons'
import { selectableCardClass } from '@/lib/selectable-card'
import { cn } from '@/lib/utils'
import { $toolViewMode, setToolViewMode } from '@/store/tool-view'
import { $translucency, setTranslucency } from '@/store/translucency'
import { $zoomPercent, setZoomPercent } from '@/store/zoom'
import { getBaseColors, useTheme } from '@/themes/context'

import { MODE_OPTIONS } from './constants'
import { ListRow, SectionHeading, SettingsContent } from './primitives'

const UI_SCALE_PRESETS = ['90', '100', '110', '125', '150', '175'] as const

function ThemePreview({ name, mode }: { name: string; mode: 'dark' | 'light' }) {
  const colors = getBaseColors(name, mode)

  return (
    <div
      className="h-16 overflow-hidden rounded-xl border"
      style={{ backgroundColor: colors.background, borderColor: colors.border }}
    >
      <div className="flex h-full">
        <div
          className="w-10 border-r"
          style={{ backgroundColor: colors.sidebarBackground ?? colors.muted, borderColor: colors.border }}
        />
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="h-2 w-16 rounded-full" style={{ backgroundColor: colors.foreground }} />
          <div className="h-2 w-24 rounded-full" style={{ backgroundColor: colors.mutedForeground }} />
        </div>
      </div>
    </div>
  )
}

export function AppearanceSettings() {
  const { t } = useI18n()
  const appearance = t.settings.appearance
  const { availableThemes, mode, resolvedMode, setMode, setTheme, themeName } = useTheme()
  const toolViewMode = useStore($toolViewMode)
  const translucency = useStore($translucency)
  const zoomPercent = useStore($zoomPercent)
  const modeOptions = MODE_OPTIONS.map(({ icon, id }) => ({ icon, id, label: t.settings.modeOptions[id].label }))
  const scaleOptions = UI_SCALE_PRESETS.map(value => ({ id: value, label: `${value}%` }))

  return (
    <SettingsContent>
      <SectionHeading icon={Palette} title={appearance.title} />
      <div className="mt-2">
        <ListRow
          below={
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {availableThemes.map(theme => (
                <button
                  className={cn(
                    'p-2 text-left',
                    selectableCardClass({ active: theme.name === themeName, prominent: true })
                  )}
                  key={theme.name}
                  onClick={() => setTheme(theme.name)}
                  type="button"
                >
                  <ThemePreview mode={resolvedMode} name={theme.name} />
                  <span className="mt-2 block truncate text-sm font-medium">{theme.label}</span>
                </button>
              ))}
            </div>
          }
          description={appearance.themeDesc}
          title={
            <div className="flex items-center justify-between gap-3">
              <span>{appearance.themeTitle}</span>
              <SegmentedControl onChange={setMode} options={modeOptions} value={mode} />
            </div>
          }
          wide
        />

        <ListRow
          action={
            <SegmentedControl
              onChange={value => setZoomPercent(Number(value))}
              options={scaleOptions}
              value={
                (UI_SCALE_PRESETS.find(value => Number(value) === zoomPercent) ??
                  '') as (typeof UI_SCALE_PRESETS)[number]
              }
            />
          }
          description={appearance.uiScaleDesc(zoomPercent)}
          title={appearance.uiScaleTitle}
        />

        <ListRow
          action={
            <div className="flex items-center gap-3">
              <input
                aria-label={appearance.translucencyTitle}
                max={100}
                min={0}
                onChange={event => {
                  triggerHaptic('selection')
                  setTranslucency(Number(event.target.value))
                }}
                step={5}
                type="range"
                value={translucency}
              />
              <span className="w-9 text-right text-sm tabular-nums text-muted-foreground">{translucency}%</span>
            </div>
          }
          description={appearance.translucencyDesc}
          title={appearance.translucencyTitle}
        />

        <ListRow
          action={
            <SegmentedControl
              onChange={setToolViewMode}
              options={[
                { id: 'product', label: appearance.product },
                { id: 'technical', label: appearance.technical }
              ]}
              value={toolViewMode}
            />
          }
          description={appearance.toolViewDesc}
          title={appearance.toolViewTitle}
        />
      </div>
    </SettingsContent>
  )
}
