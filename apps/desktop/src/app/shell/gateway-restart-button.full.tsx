import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { RefreshCw } from '@/lib/icons'
import { runGatewayRestart } from '@/store/system-actions'

export function GatewayRestartButton({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <Tip label={label}>
      <Button
        aria-label={label}
        className="text-muted-foreground hover:text-foreground"
        onClick={() => {
          onClose()
          void runGatewayRestart()
        }}
        size="icon-xs"
        variant="ghost"
      >
        <RefreshCw />
      </Button>
    </Tip>
  )
}
