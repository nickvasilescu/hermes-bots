interface FileAttachPayloadInput {
  dataUrl: null | string
  name: string
  path: string
  sessionId: string
}

export function shouldUploadAttachmentBytes(remote: boolean, pathNeedsUpload: boolean): boolean {
  return remote || pathNeedsUpload
}

export function buildFileAttachPayload({ dataUrl, name, path, sessionId }: FileAttachPayloadInput) {
  return {
    name,
    path,
    session_id: sessionId,
    ...(dataUrl ? { data_url: dataUrl } : {})
  }
}
