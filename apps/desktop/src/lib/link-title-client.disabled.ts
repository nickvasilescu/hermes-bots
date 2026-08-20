export function isTitleFetchable(_value: string): boolean {
  return false
}

export function fetchLinkTitle(_url: string): Promise<string> {
  return Promise.resolve('')
}

export function useLinkTitle(_url?: null | string): string {
  return ''
}

export function resetLinkTitleCache(): void {}
