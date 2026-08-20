export interface MediaPermissionRequest {
  isRegisteredApplicationContents: boolean
  isTopLevelFrame: boolean
  mediaTypes?: readonly string[]
  permission: string
  requestingUrl: string
}

export interface MediaPermissionPolicy {
  isTrustedRendererUrl: (url: string) => boolean
}

const ALLOWED_MEDIA_TYPES = new Set(['audio', 'video'])

export function mayGrantMediaPermission(
  request: MediaPermissionRequest,
  policy: MediaPermissionPolicy
): boolean {
  if (
    request.permission !== 'media' ||
    !request.isRegisteredApplicationContents ||
    !request.isTopLevelFrame ||
    !policy.isTrustedRendererUrl(request.requestingUrl)
  ) {
    return false
  }

  const requestedTypes = request.mediaTypes ?? []

  return requestedTypes.length > 0 && requestedTypes.every(type => ALLOWED_MEDIA_TYPES.has(type))
}
