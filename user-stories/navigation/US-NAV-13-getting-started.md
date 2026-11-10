# US-NAV-13 — Track first schedule progress

As an Owner, Admin, or Editor, I want visible first-schedule milestones so that I can prepare useful company planning data.

**Status:** Current

**Access:** Owner, Admin, Editor; demo/local mode has no membership role; Viewer does not see the Getting Started panel

**Entry:** Getting Started panel and its milestone links

**Documentation:** [Quick Start](../../docs-src/getting-started/quick-start.md)

**Source:** [GettingStarted.tsx](../../apps/frontend/src/components/GettingStarted.tsx)

## Acceptance criteria

- Five milestones reflect current company data. Each unfinished milestone links to its relevant screen; completed milestones are shown as done.
- The card can be hidden and shown with its toggle. Owner/Admin can dismiss it; when fewer than five milestones are complete, dismissal requires confirmation. Editor can use the card but has no dismiss action.
- Show me around starts the role-aware schedule tour when available. The Help page provides a separate, persistent route to start that tour.
