interface FileAttachPayloadInput {
  dataUrl: null | string
  name: string
  path: string
  sessionId: string
}

export function shouldUploadAttachmentBytes(): boolean {
  return true
}

export function buildFileAttachPayload({ dataUrl, name, sessionId }: FileAttachPayloadInput) {
  return {
    data_url: dataUrl ?? '',
    name,
    path: '',
    session_id: sessionId
  }
}
