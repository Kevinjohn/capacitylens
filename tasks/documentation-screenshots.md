# Documentation screenshot checklist

Replace the labelled placeholders in the day-to-day, Admin and Owner guides. This is the capture checklist for [issue #1100](https://github.com/Kevinjohn/capacitylens/issues/1100); it does not close the wider documentation follow-up.

46 placeholder placements are covered by 40 planned captures. Reuse a capture only when its role, state and visible controls fit every listed page.

## Capture setup

- Capture after the relevant UI changes have landed. Use the current application, not a reconstructed screen.
- For scheduling and directory screens, use the local demo with fictional Wayne Enterprises data. Follow the repository screenshot instructions and its dedicated capture port.
- For invitations, member management and first-Owner setup, use the local access test environment with disposable fictional identities. The in-memory demo does not prove real invitation or sign-in behaviour.
- Use the role listed for each capture. Do not show administrative controls in a Viewer illustration.
- Keep one consistent person, client, project and activity through related screens. Use comic-book character names and matching fictional organisations.
- Capture at least about 1400 pixels wide. Keep the page name or menu location where it helps orientation; use a readable contextual crop for a form or drawer.
- Use the suggested underscore filenames under `docs-src/screenshots/flows/`. Detailed alt text remains beside each image in the source.
- Never capture a usable invitation link, setup token, password or live customer data. Review sensitive captures against the publication ledger before committing them.

## Captures

- [ ] `using_account_1.png` — Account showing the menu location, signed-in identity and account controls.
  - Role/state: Signed-in Viewer; local sign-in environment.
  - Replace: [using/account, image 1](../docs-src/using/account.md).
- [ ] `using_activities_1.png` — Activities grouped into Internal, All projects and Project-specific sections.
  - Role/state: Viewer.
  - Replace: [using/activities, image 1](../docs-src/using/activities.md).
- [ ] `using_change_work_1.png` — Schedule with an allocation bar, its body and both resize edges highlighted.
  - Role/state: Editor.
  - Replace: [using/change-work, image 1](../docs-src/using/change-work.md).
- [ ] `using_change_work_2.png` — Edit allocation dialog with dates, activity, amount, Status, Note and Delete highlighted.
  - Role/state: Editor.
  - Replace: [using/change-work, image 2](../docs-src/using/change-work.md).
- [ ] `using_clients_1.png` — Clients showing client names and the Internal entry.
  - Role/state: Viewer.
  - Replace: [using/clients, image 1](../docs-src/using/clients.md).
- [ ] `using_disciplines_1.png` — Disciplines showing group names and colour swatches.
  - Role/state: Viewer.
  - Replace: [using/disciplines, image 1](../docs-src/using/disciplines.md).
- [ ] `using_find_capacity_1.png` — Schedule with Weeks visible, Today, Show filters and utilisation highlighted.
  - Role/state: Viewer.
  - Replace: [using/find-capacity, image 1](../docs-src/using/find-capacity.md).
- [ ] `using_read_the_schedule_1.png` — Schedule with Schedule menu item, your row and avatar/eye button highlighted.
  - Role/state: Viewer.
  - Replace: [using/index, image 1](../docs-src/using/index.md); [using/read-the-schedule, image 1](../docs-src/using/read-the-schedule.md).
- [ ] `using_join_your_team_1.png` — Invitation preview with the company, invited email and sign-in choices.
  - Role/state: Invitee; local sign-in environment.
  - Replace: [using/join-your-team, image 1](../docs-src/using/join-your-team.md).
- [ ] `using_join_your_team_2.png` — Signed-in invitation with the company and acceptance action.
  - Role/state: Invitee; local sign-in environment.
  - Replace: [using/join-your-team, image 2](../docs-src/using/join-your-team.md).
- [ ] `using_overview_1.png` — Overview showing free days, overbooked days and the planning horizon.
  - Role/state: Viewer with Overview access enabled.
  - Replace: [using/overview, image 1](../docs-src/using/overview.md).
- [ ] `using_overview_2.png` — Overview with Weeks 5–8 and Weeks 9–12 highlighted.
  - Role/state: Viewer with Overview access enabled.
  - Replace: [using/overview, image 2](../docs-src/using/overview.md).
- [ ] `using_projects_1.png` — Projects showing project names with their supporting client names.
  - Role/state: Viewer.
  - Replace: [using/projects, image 1](../docs-src/using/projects.md).
- [ ] `using_read_the_schedule_2.png` — Personal schedule drawer with date range, activity, project, client and notes highlighted.
  - Role/state: Viewer.
  - Replace: [using/read-the-schedule, image 2](../docs-src/using/read-the-schedule.md).
- [ ] `using_read_the_schedule_3.png` — One booking with its hover or keyboard-focus details visible.
  - Role/state: Viewer.
  - Replace: [using/read-the-schedule, image 3](../docs-src/using/read-the-schedule.md).
- [ ] `using_read_the_schedule_4.png` — Schedule filters open with person search, Clear Filters and Today highlighted.
  - Role/state: Viewer.
  - Replace: [using/read-the-schedule, image 4](../docs-src/using/read-the-schedule.md).
- [ ] `using_record_time_off_1.png` — Time off page with Personal time off, Add time off and an existing entry highlighted.
  - Role/state: Editor.
  - Replace: [using/record-time-off, image 1](../docs-src/using/record-time-off.md).
- [ ] `using_record_time_off_2.png` — Add time off form with Resource, Start, End, Type, Repeat, Note and Save highlighted.
  - Role/state: Admin, so the Note field is available.
  - Replace: [using/record-time-off, image 2](../docs-src/using/record-time-off.md).
- [ ] `using_resources_1.png` — Resources showing names, roles, disciplines and placeholders.
  - Role/state: Viewer.
  - Replace: [using/resources, image 1](../docs-src/using/resources.md).
- [ ] `using_schedule_work_1.png` — Schedule with a person's empty lane, row plus button and a two-day draw area highlighted.
  - Role/state: Editor.
  - Replace: [using/schedule-work, image 1](../docs-src/using/schedule-work.md); [admin/first-booking, image 1](../docs-src/admin/first-booking.md).
- [ ] `using_schedule_work_2.png` — New allocation form with Project, Activity, dates, amount and Status highlighted.
  - Role/state: Editor.
  - Replace: [using/schedule-work, image 2](../docs-src/using/schedule-work.md); [admin/first-booking, image 2](../docs-src/admin/first-booking.md).
- [ ] `using_settings_1.png` — Settings showing My display and this-browser preferences.
  - Role/state: Viewer.
  - Replace: [using/settings, image 1](../docs-src/using/settings.md).
- [ ] `using_team_access_1.png` — Team and access showing a Viewer's access explanation.
  - Role/state: Viewer; local sign-in environment.
  - Replace: [using/team-access, image 1](../docs-src/using/team-access.md).
- [ ] `using_time_off_1.png` — Time off showing company closures and personal time off entries.
  - Role/state: Viewer.
  - Replace: [using/time-off, image 1](../docs-src/using/time-off.md).
- [ ] `using_time_off_2.png` — Schedule showing the same personal absence beside planned work.
  - Role/state: Viewer.
  - Replace: [using/time-off, image 2](../docs-src/using/time-off.md).
- [ ] `admin_add_people_1.png` — Resources: Add resource and the person form with Working days.
  - Role/state: Admin.
  - Replace: [admin/add-people, image 1](../docs-src/admin/add-people.md).
- [ ] `admin_add_people_2.png` — Team & access: Link to Resource dialog with a person selected.
  - Role/state: Admin; local sign-in environment.
  - Replace: [admin/add-people, image 2](../docs-src/admin/add-people.md).
- [ ] `admin_company_settings_1.png` — Settings: Company setup controls and Overview access.
  - Role/state: Admin.
  - Replace: [admin/company-settings, image 1](../docs-src/admin/company-settings.md).
- [ ] `admin_company_settings_2.png` — Settings: Scheduling features switches.
  - Role/state: Admin.
  - Replace: [admin/company-settings, image 2](../docs-src/admin/company-settings.md).
- [ ] `admin_invite_teammates_1.png` — Team & access: Invite someone with Role, email and Create invite.
  - Role/state: Admin; local sign-in environment.
  - Replace: [admin/index, image 1](../docs-src/admin/index.md); [admin/invite-teammates, image 1](../docs-src/admin/invite-teammates.md).
- [ ] `admin_invite_teammates_2.png` — Team & access: accepted member with Admin role, Edit member and Member settings.
  - Role/state: Owner; local sign-in environment. Crop to the member row so the image also fits the Admin guide.
  - Replace: [admin/invite-teammates, image 2](../docs-src/admin/invite-teammates.md); [owner/appoint-an-admin, image 2](../docs-src/owner/appoint-an-admin.md).
- [ ] `admin_ongoing_administration_1.png` — Team & access: Member settings dialog.
  - Role/state: Admin; local sign-in environment.
  - Replace: [admin/ongoing-administration, image 1](../docs-src/admin/ongoing-administration.md).
- [ ] `admin_ongoing_administration_2.png` — Time off: Company closures with Add closure form.
  - Role/state: Admin.
  - Replace: [admin/ongoing-administration, image 2](../docs-src/admin/ongoing-administration.md).
- [ ] `admin_prepare_work_1.png` — Clients: Add client form.
  - Role/state: Admin.
  - Replace: [admin/prepare-work, image 1](../docs-src/admin/prepare-work.md).
- [ ] `admin_prepare_work_2.png` — Projects: Add project form with Client selected.
  - Role/state: Admin.
  - Replace: [admin/prepare-work, image 2](../docs-src/admin/prepare-work.md).
- [ ] `admin_prepare_work_3.png` — Activities: Add activity form with Kind and Project.
  - Role/state: Admin.
  - Replace: [admin/prepare-work, image 3](../docs-src/admin/prepare-work.md).
- [ ] `owner_appoint_an_admin_1.png` — Team & access showing Invite someone with Admin, email, No Resource linked and Create invite.
  - Role/state: Owner; local sign-in environment.
  - Replace: [owner/appoint-an-admin, image 1](../docs-src/owner/appoint-an-admin.md).
- [ ] `owner_create_your_company_1.png` — First Owner sign-in: local setup form and company login option.
  - Role/state: Owner; local sign-in environment.
  - Replace: [owner/create-your-company, image 1](../docs-src/owner/create-your-company.md).
- [ ] `owner_create_your_company_2.png` — Company form: Company name, Week starts on, Timezone and Create company.
  - Role/state: Owner; local sign-in environment.
  - Replace: [owner/create-your-company, image 2](../docs-src/owner/create-your-company.md); [owner/index, image 1](../docs-src/owner/index.md).
- [ ] `owner_responsibilities_1.png` — Team & access showing Members, Record member sign-ins and Company ownership.
  - Role/state: Owner; local sign-in environment.
  - Replace: [owner/responsibilities, image 1](../docs-src/owner/responsibilities.md).

## State preparation

- Schedule/work list: give the featured person current and upcoming bookings, personal time off and readable project/activity details. Show the avatar eye control, then the open four-week drawer.
- Booking details: open the hover or keyboard-focus detail view. For edit/create forms, use the default Days mode unless the text explicitly demonstrates another unit.
- Capacity: include both available and overbooked people. Capture the four-week view and the 12-week grouped totals separately.
- Resources: include a named person with working days and a project-bound placeholder. Enable disciplines and placeholders for the illustrations that show them.
- Activities: include Internal, All projects and Project-specific groups; make the project and client relationship visible.
- Time off: use the same absence in the list and Schedule captures. Notes must only appear in the permitted Admin/Owner capture.
- Invitations: capture the preview before sign-in, the acceptance screen after sign-in, the invitation form, and the accepted member row as distinct states. Leave bearer values out of the images.
- Owner creation: start with an unused local setup. The company form opens after first sign-in; it must not show a pre-populated schedule or imply a language selector.
- Ownership: show Record member sign-ins and Company ownership in the Owner view. Use a contextual crop if both controls cannot remain readable in one frame.

## Completion checks

- [ ] Every listed placeholder is replaced, or removed with a recorded editorial reason.
- [ ] Each image is inspected at full size for accurate UI, readable text and safe fictional data.
- [ ] Images appear before the instructions they support, with useful alt text and working enlargement.
- [ ] Related before/after images use consistent data and dates.
- [ ] Desktop and narrow-screen documentation previews are checked.
- [ ] Run `pnpm run docs:build` using the worktree’s `.nvmrc` runtime and commit regenerated `docs/`.
- [ ] Remove the draft-placeholder footer once no planned placeholders remain.
