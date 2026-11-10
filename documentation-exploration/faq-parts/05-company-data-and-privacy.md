## Settings and access

<span id="faq-company-company-details"></span>

### Can I change the company name, week start or time zone in Settings?

No. **Settings → Data and support → Company details** shows these values as a read-only summary for every role. The company name, week start and time zone are selected during company setup; there is no current Settings control for changing them later. The time zone determines which date the app treats as today. [Settings](../../docs/using/settings.html#calendar) explains the summary.

<span id="faq-company-my-display"></span>

### Which display choices affect only my browser?

Open **Settings → My display** to choose whether schedule bars show client and project names, minimise weekend columns, and show total, discipline or personal utilisation figures. These switches start on; the discipline figure appears only when the company uses disciplines. The choices apply to this browser and do not change the company's plan or appear in an export. Your appearance choice is also per device. Weekend columns narrow only at day-level zoom.

<span id="faq-company-schedule-behavior"></span>

### Can I change date formatting or make weekends narrower?

**Minimise weekends** is under **Settings → My display → Schedule on this device** and changes only your browser's grid. Schedule aligns to the company's week boundaries automatically; there is no setting to turn that behavior on or off. Company date format is under **Settings → Company setup** and is shared by everyone. Editors and above can choose **9 Sep**, **9th Sep**, **Sep 9** or **Sep 9th**. [Settings](../../docs/using/settings.html) lists the personal and company choices.

<span id="faq-company-company-planning-settings"></span>

### Which shared planning settings can an Editor change?

Editors, Admins and Owners can change **Company setup** choices such as **Allocation units**, **Company-wide working days** and **Date format**. **Hours** asks for hours per day, **Days** for work days spread over a span, and **Blocks** for a span without measuring workload. Changing units does not rewrite existing bookings. Working-day changes apply immediately, recalculate capacity and conflicts, and leave booking dates where they are. At least one company working day must remain selected.

<span id="faq-company-overview-access"></span>

### Why can’t I open Overview?

Overview access defaults to **Admins** (Owners and Admins). An Owner or Admin can change **Settings → Company setup → Overview access** to **Admins & Editors** or **Everyone**. The choice controls who can open Overview, not who can see the schedule data. It does not make bookings or resources private from other company members.

<span id="faq-company-scheduling-features"></span>

### What happens when a company feature is turned off?

Editors, Admins and Owners can change the **Company features** switches in **Settings → Scheduling features**. **Use disciplines**, **Show placeholders**, **Show external resources**, **Inline activity creation** and **Show task field in schedule** affect the whole company. Turning a switch off hides its controls or rows; it does not delete existing records or task text. New production companies start with these features off; the demo starts with **Use disciplines** on. Viewers can read the settings but cannot change them.

<span id="faq-company-internal-work-colour"></span>

### Can I choose a colour for Internal work?

No. Internal projects and activities use neutral grey automatically. There is no colour setting for Internal work. Use the project or activity colours for client work instead.

<span id="faq-company-diagnostics"></span>

### Where can I find build details or send a problem report?

Owners and Admins can open **Diagnostics**. Select **Copy diagnostics** to copy the support report; the page confirms the copy or reports if the browser blocks it. **Build details** appears when the installation provides build information; **Send feedback** appears only when a valid feedback address is configured and opens a preaddressed email draft. If an option is missing, that information or address is not configured. [Diagnostics](../../docs/admin/diagnostics.html) explains what the report contains.

<span id="faq-company-password-reset"></span>

### What if I forgot my password?

On the sign-in page, select **Forgot password?** and follow the emailed reset link. If the email does not arrive, ask your installation operator to check mail delivery. Resetting your password ends every active session, including the one you are using, so you must sign in again on all browsers and devices. [Account](../../docs/using/account.html#if-you-can-t-sign-in) has the recovery steps.

<span id="faq-company-archive-restore"></span>

### Where do I restore an archived person, client, project or activity?

An Editor or above can restore an eligible archived item on its own **Resources**, **Clients**, **Projects** or **Activities** page; it is not restored from Settings. Archiving a client, project or activity hides its related booking bars until restored. Archiving a person hides their row from Schedule while keeping their past bookings. An Owner or Admin can also anonymise an archived person; that removes identifying details and dependent notes and cannot be undone. Use [Anonymise all people](#faq-company-anonymise-all) for the separate company-wide action. [Resources](../../docs/using/resources.html#archive-someone-who-leaves) and [Clients and projects](../../docs/using/projects.html#archive-or-restore-a-client-or-project) explain their archive views.

<span id="faq-company-transfer-ownership"></span>

### How does the Owner transfer company ownership?

Only the current Owner can transfer ownership. In **Team & access → Company ownership**, choose another active Admin, select **Transfer ownership**, then confirm with the current Owner's password. The selected Admin becomes Owner and the former Owner becomes Admin immediately. Closing or cancelling the confirmation leaves ownership unchanged. No one can become Owner through an invitation or ordinary role change.

<span id="faq-company-anonymise-all"></span>

### What does “Anonymise all people” remove?

On a server installation, only the Owner can use **Settings → Data and support → Anonymise all people**. After the confirmation, enter the Owner's current password to continue. This irreversible action removes identifying resource details and personal notes from bookings and time off across the company. It keeps the company, catalogue, memberships and planning links. It cannot be undone. In the temporary demo, it changes only in-memory data and does not ask for a password.

<span id="faq-company-check-role"></span>

### Where do I check my company role and permissions?

Open **Team & access → Your access** and select **See full capabilities**. Every role can check its own access; the demo shows a demo-access note instead of real membership permissions. Viewers can read the schedule; Editors can also change planning and ordinary company settings; Owners and Admins manage invitations and memberships. Only the Owner sees private client and project real names in ordinary company use. Ask an Owner or Admin if you need a different role.

## Teammates and invitations

<span id="faq-company-invite-teammate"></span>

### How does an Owner or Admin invite a teammate?

In **Team & access**, choose **Invite someone**, select **Editor**, **Viewer** or **Admin**, enter the teammate's email and choose **Create invite**. The app emails the invitation to that address and does not show its link; only that address can accept it. The default role is Editor; Owner is not offered. If mail delivery is unavailable, the invite cannot be created. If the invite was saved but email delivery failed, use **Resend** on that invitation after delivery is available.

<span id="faq-company-pending-invitation"></span>

### How do I resend or cancel an invitation?

An Owner or Admin can find unaccepted invitations under **Team & access → Outstanding invites**. **Resend** emails a fresh link and makes the earlier link stop working. **Revoke** cancels an invitation that has not expired; expired invitations have no Revoke action. Invitations expire after seven days. If the person already has an account, ask the person who manages the service to help that existing account join the company, rather than creating a second account.

<span id="faq-company-accept-invitation"></span>

### Does accepting an invitation give someone access to company data?

The invitation page shows the company and offered role. The invitee enters **Name** and **Password**, then selects **Accept invitation**. If the next screen offers **Ask for access**, the sign-in and membership exist, but the invitation alone has not granted access to company data. Select **Ask for access** and wait for an Owner or Admin to approve. An invitation does not create a schedule person.

<span id="faq-company-admission"></span>

### How does the invitee check whether access was approved?

When the access screen offers **Ask for access**, the invitee selects it and waits for an Owner or Admin. The approver opens **Team & access → Waiting for approval** and chooses **Approve** or **Decline**. The invitee selects **Check again** to refresh the result; access changes take effect on that next request. If **Join company** appears because the person has no membership yet, select it to finish joining. Some installations also restrict which email domains can join. If access was declined or revoked, contact an Owner or Admin; the screen has no request or refresh control then.

<span id="faq-company-member-role-or-status"></span>

### Can an Owner or Admin change a member's role or suspend them?

In **Team & access → Members**, use the member's actions to edit their role or choose **Suspend**. **Restore membership** returns a suspended person with their previous role. Suspension takes effect on their next request and keeps their role and history. Owners and Admins cannot change their own membership or the Owner's membership. An Admin cannot promote someone to Owner; ownership uses its separate transfer action.

<span id="faq-company-link-member-resource"></span>

### Does a teammate need a linked Resource to sign in?

No. A member can sign in and use the company without a schedule row linked to them. An Owner or Admin can optionally choose **Link to Resource** from the member row in **Team & access**, then select an available active person. Choosing or removing a link saves immediately; it connects the sign-in to an existing row but does not create a Resource or change the person's access role. Anyone who can see a row can open its avatar work list, linked or not.

<span id="faq-company-view-as-member"></span>

### What does “View the app as this member” do?

An Owner or Admin can select **View the app as this member** on another active member's row in **Team & access**. After confirmation, a banner identifies the member and shows when the view ends. It lasts 15 minutes; choose **End now** to return sooner. This view is read-only: it cannot change the plan, membership or company settings. The view applies to all signed-in sessions. Signing out ends it only for the current session; other active sessions keep it until it is ended or expires. If the member view needs restoring, choose **Retry** in the banner.

<span id="faq-company-sign-in-tracking"></span>

### Can I turn on member sign-in tracking?

There is no current **Record member sign-ins** switch or **Signed in** column in the product interface. The Owner cannot enable this from **Team & access**. Do not use a missing column as evidence that a member has or has not signed in.

## Company data and privacy

<span id="faq-company-export-data"></span>

### What does Export JSON include, and who can use it?

Any company member can select **Settings → Data and support → Export JSON**. The export contains company scheduling data and supported settings, not member accounts, sessions, invitations or this browser's display choices. The export follows the role you are currently viewing: Owner and Admin views include archived and deleted planning records; Editor and Viewer views include active records. Normally only the Owner receives private real names; an ordinary Admin export uses code names. An Admin deliberately viewing the app as the Owner also exports that Owner view, including real names. Keep an export protected like company data.

<span id="faq-company-import-data"></span>

### How do I preview and replace company data?

Only an Owner can import on a server installation. In **Settings → Data and support → Import JSON**, choose a full JSON export made by CapacityLens and select **Continue**. Review the company and record count, then choose **Replace data**. Server imports require the Owner's current password to confirm that exact file. Cancel or a rejected preview leaves company data unchanged; if company data changed after preview, preview again. A full export can restore planning to a prepared company; invitees and sign-ins must be set up separately.

<span id="faq-company-import-undo"></span>

### Can I undo an import?

No. A confirmed import replaces the selected company's planning data and settings, and it cannot be undone with Schedule **Undo** or **Redo**. Export the current company first if you may need to restore it. Imported data also starts without the previous page's Undo history.

<span id="faq-company-invalid-import"></span>

### Why was my import file rejected?

Import accepts only a valid, full CapacityLens export. A redacted export, another product's file or a malformed file is rejected before replacement, leaving current company data in place. Do not edit the JSON to try to repair it; export a fresh full file from CapacityLens and preview that file. If the export is redacted, only an Owner's full export can restore private names.

<span id="faq-company-save-and-reload"></span>

### Do saved changes remain after I reload?

On a server-backed company, a change remains after reload once the server has saved it. A bar that appears immediately is not proof that its save completed. The app may retry while the page remains open, but it does not save scheduling data in the browser for recovery after reload. If a save result is uncertain, inspect the latest company data before repeating the action because it may already have been saved.

<span id="faq-company-conflict"></span>

### What if another person changed the plan while I was editing?

That edit is refused and the app loads the latest company plan. Close and reopen the form, review the current values, then reapply your change. Your earlier edit was not saved. For a result that is uncertain rather than refused, check the refreshed plan before trying again so you do not duplicate a change that already committed. [Connection errors](../../docs/using/settings.html#connection-errors) explains the visible save warning.

<span id="faq-company-example-data"></span>

### Can I add example data to an existing company?

Only Owners and Admins can add example data, and only to an empty server-backed company. **Add example data** creates two people, a client, a project and sample bookings. It is unavailable once planning records exist, including archived records. The built-in **Internal** client alone does not block this option. The new records are ordinary records that can be archived.

<span id="faq-company-demo-data"></span>

### What happens to demo changes when I leave or reload?

The demo is temporary and in memory. Your changes last only while the demo page remains open; reloading restores its original example data. Demo changes are not saved to a company server and are not a durable backup. Use a server-backed company for planning that must remain available after reload.

<span id="faq-company-private-names"></span>

### Who can see or change a private client or project name?

When **Use code name** is on, the Owner's ordinary view shows the real name; Admins, Editors and Viewers see the code name. An Admin who deliberately uses the read-only member view as the Owner sees the Owner's view. Only the Owner can change the privacy fields. An Admin or Editor can make permitted ordinary edits, but those edits preserve private fields they cannot see. [Privacy](../../docs/security/privacy.html) explains the name projection.
