# US-SET-12 — Archive and anonymise records

**Area:** Lifecycle · **Persona:** Studio manager / admin · **Linked E2E:** `e2e/archived.spec.ts`

**Documentation:** [Resources](../../docs-src/using/resources.md)

## Goal

Let an Editor or above remove a resource, client, project or activity from active planning by
archiving it, and restore it from the inline archive. An Owner or Admin can irreversibly anonymise
a resource when its identifying details must be removed while its planning links remain.

## Why

Paused work should leave the active schedule without losing its planning links. When a person's
identifying details must be removed, anonymisation must preserve those links while making the
personal details and dependent notes unrecoverable through Undo.

## How (end-to-end)

1. Archive Barry Allen from Resources. He leaves the Resources list and schedule, then **Restore**
   him from **Archived Studio**; his planning links remain.
2. Choose **Anonymise** for a resource and confirm. Its name and role become obfuscated, its avatar
   and dependent allocation and time-off notes are cleared, and Undo cannot restore them.
3. As the Owner, choose **Anonymise all people** in Settings. In a signed-in company, confirm
   the exact action with fresh proof; in the editable demo, confirm it in page memory.

## Acceptance criteria

- ✅ Archiving Barry Allen hides him from the Resources list and schedule. Restoring him from
  **Archived Studio** returns him to both places without losing his planning links.
- ✅ A resource's **Anonymise** action asks for confirmation. After confirmation, the resource stays
  in the company with an obfuscated name and role, no avatar, and no dependent allocation or
  time-off notes. Undo cannot restore those personal details.
- ✅ An Owner can select **Anonymise all people** in Settings. Clients, projects and activities
  stay unchanged, as do the company, memberships and planning links. A signed-in Owner confirms
  this exact action with a fresh proof; the editable demo applies it in page memory without sign-in.
- ✅ Clients, projects and activities can be archived and restored. They have no anonymise action.
- ✅ An Editor may archive and restore through planning controls but cannot anonymise a resource.
  Viewers cannot edit. The built-in **Internal** client cannot be archived.
- ✅ The editable demo applies the same visible transitions in temporary memory. Refresh resets it.
  Persisted actions require the authenticated member's server-side authority.
