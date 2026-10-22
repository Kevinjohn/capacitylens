# US-SET-12 — Archive and anonymise records

**Area:** Lifecycle · **Persona:** Studio manager / admin · **Linked E2E:** `e2e/archived.spec.ts`

**Documentation:** [Resources](../../docs-src/using/resources.md)

## Goal

Let a member remove a resource, client, project or activity from active planning by archiving it,
and let an Owner or Admin restore it from the inline archive. An Owner or Admin can irreversibly
anonymise a resource when its identifying details must be removed while its planning links remain.

## Outcomes

- Archiving Barry Allen hides him from the Resources list and schedule. Restoring him from
  **Archived Studio** returns him to both places without losing his planning links.
- A resource's **Anonymise** action asks for confirmation. After confirmation, the resource stays
  in the company with an obfuscated name and role, no avatar, and no dependent allocation or
  time-off notes. Undo cannot restore those personal details.
- An Owner can anonymise every resource in the company from Settings. The company, memberships
  and planning links remain. A signed-in Owner confirms this exact action with a fresh proof;
  the editable demo applies it in page memory without sign-in.
- Clients, projects and activities can be archived and restored. They have no anonymise action.
- An Editor may archive and restore through planning controls but cannot anonymise a resource.
  Viewers cannot edit. The built-in **Internal** client cannot be archived.
- The editable demo applies the same visible transitions in temporary memory. Refresh resets it.
  Persisted actions require the authenticated member's server-side authority.
