export function requestOpenExternal(href: string): void {
  if (href) {void window.hermesDesktop?.openExternal?.(href)}
}
