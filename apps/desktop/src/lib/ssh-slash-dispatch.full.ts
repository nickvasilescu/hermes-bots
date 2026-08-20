export function dispatchUnknownSlashCommand(name: string, dispatch: () => Promise<void>): Promise<void> {
  void name

  return dispatch()
}
