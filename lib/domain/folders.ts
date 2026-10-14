import type { Folder } from '../types'
import { sanitiseFolderName } from './rules'

/**
 * Folder trees.
 *
 * Graph creates folders one level at a time (`POST …/childFolders`), so filing
 * a message into "Clients/Acme/Invoices" on a fresh mailbox is three creates
 * in order, each needing its parent's id. This works out which levels already
 * exist and which must be made, so the executor does exactly the creates
 * required and nothing is created twice when two messages race for the same
 * new folder (the executor serialises per account; this keeps it idempotent).
 *
 * Paths are rooted at the top of the mailbox, as Outlook shows them in the
 * folder pane — not under the Inbox. Matching is case-insensitive because
 * Exchange's is.
 */

export interface FolderPlan {
  /** Deepest existing folder on the path, or null if starting at the root. */
  existing: Folder | null
  /** Segments still to create, outermost first. */
  toCreate: string[]
}

export function splitPath(path: string): string[] {
  return path.split('/').map(sanitiseFolderName).filter(Boolean)
}

export function planFolder(folders: Folder[], accountId: string, path: string): FolderPlan {
  const segments = splitPath(path)
  const mine = folders.filter((f) => f.accountId === accountId)

  let parent: Folder | null = null
  let i = 0
  for (; i < segments.length; i++) {
    const name = segments[i]!.toLowerCase()
    const parentId: string | null = parent ? parent.id : null
    const next: Folder | undefined = mine.find((f) => f.parentId === parentId && f.displayName.toLowerCase() === name)
    if (!next) break
    parent = next
  }

  return { existing: parent, toCreate: segments.slice(i) }
}

export function joinPath(parent: Folder | null, name: string): string {
  return parent ? `${parent.path}/${name}` : name
}

/** Folders as an indented outline for the dashboard. */
export function folderTree(folders: Folder[]): Array<Folder & { depth: number }> {
  const byParent = new Map<string | null, Folder[]>()
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? []
    list.push(f)
    byParent.set(f.parentId, list)
  }
  const out: Array<Folder & { depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => {
      // Well-known folders first, in Outlook's order, then alphabetical.
      const rank = (f: Folder) => (f.wellKnown ? ['inbox', 'drafts', 'sentitems', 'archive', 'junkemail'].indexOf(f.wellKnown) : 99)
      return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName)
    })
    for (const child of children) {
      out.push({ ...child, depth })
      walk(child.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}
