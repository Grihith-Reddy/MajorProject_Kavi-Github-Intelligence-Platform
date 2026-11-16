/** Key under which the last opened repository is remembered between visits. */
export const ACTIVE_REPO_STORAGE_KEY = 'kavi.activeRepoId'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Repository ids come from the address bar and local storage and end up inside API paths, so only
 * a well-formed UUID is accepted; anything else (for example "../../github/status") is ignored.
 */
export function asRepoId(value: string | null | undefined): string | null {
  return value && UUID.test(value) ? value : null
}

export function readStoredRepoId(): string | null {
  try {
    return asRepoId(window.localStorage.getItem(ACTIVE_REPO_STORAGE_KEY))
  } catch {
    return null
  }
}
