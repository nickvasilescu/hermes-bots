export function serializeJsonBody(body: unknown): Buffer | undefined {
  return body === undefined ? undefined : Buffer.from(JSON.stringify(body))
}

export function setJsonRequestHeaders(request: { setHeader: (name: string, value: string) => void }): void {
  request.setHeader('Content-Type', 'application/json')
}
