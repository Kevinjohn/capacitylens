# US-ACT-01 — Add an activity (internal, all-projects, or project-specific)

As an Editor, I want to add an activity as Project-specific, Internal or All projects so that work is categorized correctly.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Activities screen → Add activity
**Documentation:** [Guide](../../docs-src/using/activities.md)
**Source:** [ActivityList.tsx](../../apps/frontend/src/components/activities/ActivityList.tsx) · [ActivityForm.tsx](../../apps/frontend/src/components/activities/ActivityForm.tsx)

## Acceptance criteria

| Field   | Control          | Required/default/conditions                                                               |
| ------- | ---------------- | ----------------------------------------------------------------------------------------- |
| Name    | Text field       | Required; initially blank                                                                 |
| Kind    | Segmented choice | Required; defaults to Project-specific; options: Project-specific, Internal, All projects |
| Project | Picker           | Required for Project-specific only; active projects                                       |

- **Save** adds the activity. Invalid required values keep the form open with an error. **Cancel** closes without saving.
