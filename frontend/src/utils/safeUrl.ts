/**
 * Links inside AI answers can be steered by repository content (a PR body, a comment),
 * so only plain web links and in-app paths are allowed. React 18 still renders
 * `javascript:` URLs, which would run script in KAVI's origin when clicked.
 */
export function safeExternalUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/** In-app path such as `/why?path=...`; rejects protocol-relative `//host` links. */
export function isInternalPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
}
