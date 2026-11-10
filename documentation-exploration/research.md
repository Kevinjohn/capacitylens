# Make the next action easy to find

**Recommendation:** organise everyday help around the work someone came to do. Keep a short first-week route, show role restrictions beside the affected action, and move exhaustive options into reference pages. Improve the route before changing the documentation engine.

This is an editorial investigation and sample collection for [#1846](https://github.com/Kevinjohn/capacitylens/issues/1846), researched on **10 November 2026** against repository revision `ac69d13a1`. The examples are alternatives for review; the current documentation remains intact.

[Compare the three designs](index.html) · [Source observations](sources.md) · [Verification and limits](verification.md)

On this page: [Diagnosis](#why-the-current-documentation-feels-larger-than-the-product) · [Examples](#what-the-strongest-examples-contribute) · [Writing](#writing-direct-calm-and-specific) · [Page length](#how-much-belongs-on-one-page) · [Navigation](#structure-and-submenus) · [Layout](#layout-make-the-text-easier-to-use) · [Alternatives](#three-alternatives-to-choose-between)

## Why the current documentation feels larger than the product

The existing [style guide](../docs-src/STYLE.md) already makes many of the right decisions: plain language, actual screens, concise instructions, meaningful warnings and no card layouts. The individual sentences are generally clear. The reader's route needs more attention.

- **Several organising systems compete.** The everyday sidebar offers role routes, screen guides, task instructions and an FAQ. A person trying to move a booking must decide between “Plan work as an Editor”, “Schedule”, “Schedule and change work” and “FAQ”. These are legitimate documents with overlapping promises.
- **The entry page is another directory.** [See your work](../docs-src/using/index.md) has 23 non-image Markdown links. It initially says most people need very little, then offers a substantial “Go further” list. The first visit can feel like the start of a course.
- **Long reference is doing introductory work.** Schedule covers navigation, the work list, grouping, bars, capacity, closures, filters and the command palette. Those details are valuable when needed; they compete with the immediate question when presented together.
- **Role routes repeat shared behaviour.** Admin, Editor and Viewer guidance all explain parts of joining, reading the schedule, capacity and settings. The same rule is maintained in several places, and shared screens acquire several introductions.
- **A screenshot can delay the action.** The published Schedule page starts with a large full-window capture. It orients the reader, but its small controls still need enlargement. A focused crop beside a specific instruction would sometimes do more with less space.
- **Search is absent from the shipped build.** The source config declares local search, but [the standalone build](../scripts/docs-standalone.mjs) removes the client interface and hides `.VPNavBarSearch`. The published Schedule page inspected during this investigation also has no visible search. Good titles and cross-links therefore carry more responsibility than the development preview suggests.

A rough size check makes the scale visible. Counting whitespace-delimited tokens after removing YAML front matter gives 17 everyday pages / 11,451 tokens, nine Admin pages / 3,271 tokens and five Owner pages / 1,731 tokens. Within everyday help, Settings is 1,641 tokens, Schedule 1,406 and Schedule and change work 1,244. These are reproducible size proxies, including Markdown/HTML and image descriptions, **not reading-time estimates or evidence that a long page is bad**.

There is also a maintenance signal: the everyday entry page describes **Create account and accept**, while the current invitation component and focused joining page use **Accept invitation**. This investigation does not correct the live page, but the alternatives follow the current component. Reducing repeated instructions can reduce this kind of drift.

## What the strongest examples contribute

These are useful exemplars for particular decisions, not a ranking of whole documentation sites. Inspection establishes observable patterns, not that their users find information faster.

| Example                                                                                                                    | Useful observed pattern                                                                         | CapacityLens application                                                  | What to leave behind                                                 |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [Immich quick start](https://docs.immich.app/overview/quick-start/)                                                        | A defined starting point, one initial path, numbered actions and a concrete trial of the result | Offer one first-week route before presenting every option                 | Infrastructure detail and its much broader product navigation        |
| [Actual Budget: Starting Fresh](https://actualbudget.org/docs/getting-started/starting-fresh/)                             | Setup follows a meaningful workflow; specialist tasks are linked from that workflow             | Teach the cycle of availability → bookings → review                       | Its extended conceptual discussion inside onboarding                 |
| [Astro tutorial](https://docs.astro.build/en/tutorial/0-introduction/) and [recipes](https://docs.astro.build/en/recipes/) | Guided learning and focused task recipes have distinct purposes                                 | Keep a walkthrough optional and let returning readers enter at a task     | A developer curriculum, ecosystem tree and progress tracker          |
| [Django: What to read next](https://docs.djangoproject.com/en/5.2/intro/whatsnext/)                                        | Distinguishes guided learning, conceptual guides, common tasks and exact reference              | Decide each page's purpose before drafting                                | Four visible taxonomy buckets if three simple user sections suffice  |
| [Penpot: First Steps](https://help.penpot.app/user-guide/first-steps/)                                                     | A compact entry page describes what each destination gives the reader                           | A short help home can offer useful routes without retelling them          | Another chooser for every job title                                  |
| [Home Assistant: Automations](https://www.home-assistant.io/docs/automation/)                                              | Separates a first tutorial, explanations, reference and symptom-based recovery                  | Link “book your first work” to deeper booking options and relevant errors | Deep nested navigation appropriate to a much larger product          |
| [Godot documentation introduction](https://docs.godotengine.org/en/stable/about/introduction.html)                         | Explicitly distinguishes an introductory route from a manual browsed as needed                  | Say that the ten-page route is optional                                   | Engine/API reference scale and extensive prerequisite lessons        |
| [Frappe desktop navigation](https://docs.frappe.io/framework/user/en/desk/navigation/desktop)                              | Names interface regions and relates instructions to what permissions reveal                     | Name **Schedule**, the person's row and the exact control                 | Its apps/modules hierarchy and large framework sidebar               |
| [BookStack: Getting Around](https://www.bookstackapp.com/docs/user/getting-around/)                                        | Documents several ways to reach content rather than assuming one linear route                   | Provide task links, current-page state and sensible onward routes         | The current user index's long chronological list of article excerpts |
| [Caddy reverse-proxy quick start](https://caddyserver.com/docs/quick-starts/reverse-proxy)                                 | Gives prerequisites, an action and a direct way to check the result                             | Follow “Save” with what should appear and what to check                   | Terminal-oriented presentation for ordinary planning help            |

Public repository inspection is recorded in [Source observations](sources.md), including archived or moved sources. Source code helps establish how a site is organised; it is not a substitute for reading the rendered page.

[Diátaxis](https://www.diataxis.fr/start-here/) is a useful editorial check: is this page teaching, helping someone do a task, explaining a rule, or listing precise options? Apply that distinction behind the scenes. Readers do not need to learn our documentation taxonomy.

## Writing: direct, calm and specific

1. **Put the answer in the first sentence.** “Open Schedule and select the avatar beside your name” is more useful than announcing what the guide covers.
2. **Name the location and control together.** “In Resources, select Add resource.” Avoid “add a person” without saying where.
3. **Use the reader's task as a procedure title.** “Move a booking to someone else” communicates more than “Allocation management”. Keep **Schedule** as the title of a genuine screen reference.
4. **Make restrictions local.** “An Owner or Admin sends invitations” belongs beside the invitation steps. A permission matrix is available for comparison, not required reading.
5. **Keep warmth in useful reassurance.** “Adding someone to the schedule does not send them an invitation” resolves a real uncertainty. “You're all set!” contributes little if the result has not been checked.
6. **Explain an unfamiliar product distinction once.** A person on the schedule and a member who can sign in are different. Clients and agencies do not need generic business definitions.
7. **Preserve the important caveat.** A percentage below 100% can hide an overloaded day. Reducing text must not remove the daily check or the fixed 14-day warning rule.
8. **Put recovery at the point of interruption.** A failed invitation email belongs with invitations; an uncertain save belongs with changing the plan. Keep a short symptom index for readers who arrive through an error.

### Before and after

The “after” examples demonstrate editing choices; they do not replace the detailed reference.

| Current wording or structure                                                                        | Suggested treatment                                                                                            | Why                                                                               |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Editor opens with an inventory of editable objects and Owner-only operations                        | “Check next week's working days, time off and bookings on Schedule. Then add or move work.”                    | Start with the planner's job; reserve exceptional authority for the relevant task |
| Viewer introduction lists bookings, resources, time off and company settings that cannot be changed | “Use Schedule to review your work. Ask the planner if a booking needs changing.”                               | Gives a useful action before the boundary                                         |
| Admin entry explains its own five-step guide and guides the reader need not read                    | “Add the people and work you plan, then book a person. Invite teammates who need to see or maintain the plan.” | Describes product actions instead of documentation architecture                   |
| A booking page opens with general context before locating the control                               | “On Schedule, select + on the person's row. Choose Project and Activity, then check the dates and amount.”     | Makes the start of the task locatable                                             |
| Overview access described as a general prerequisite for team review                                 | “If Overview is available, use it to compare weekly capacity. Everyone can review Schedule.”                   | Keeps the Viewer route usable under default permissions                           |

## How much belongs on one page?

Page length follows the decision being made. These ranges are drafting prompts, not acceptance limits.

| Page purpose                | Useful content                                                                   | Typical starting range         | Move elsewhere                                                   |
| --------------------------- | -------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| Help home                   | A few common needs and clearly named destinations                                | 100–200 words                  | Product sales pitch, full permission table, every reference link |
| Routine task                | Where to start, essential steps, expected result, likely interruption            | 150–350 words                  | Every optional field and rare policy exception                   |
| First-use walkthrough stage | A concrete example, steps, a visible result and the next handoff                 | 200–450 words                  | Repeated explanations of earlier lessons                         |
| Screen reference            | What each meaningful region/control does, with anchors                           | Whatever the subject needs     | Onboarding narrative and repeated basic tasks                    |
| High-consequence operation  | Authority, effect, prerequisites, confirmation, verification and recovery limits | Whatever safe completion needs | Nothing required to make an informed choice                      |

A short page fails if it sends readers elsewhere for the next essential instruction. A long reference succeeds if readers can land on the exact answer. Split by distinct need, not by arbitrary word count. Combine tiny dependent actions when separating them would make readers hop between pages; creating a client, project and first activity can stay together.

## Structure and submenus

Use three reader-facing sections. Their names describe actual needs:

- **Use CapacityLens:** plan next week, see your work, add/change bookings, manage time off, find capacity, recover a failed change.
- **Manage the company:** invite or remove access, connect a member to a schedule row, settings, Owner responsibilities and privacy/data operations.
- **Install and run:** installation, email, backups, upgrades, service problems and technical reference.

Keep a small product introduction and demo link available from the help home. Contributor architecture, test records and historical security reviews can remain accessible from a separate contributor/reference destination rather than the everyday sidebar.

Within **Use CapacityLens**, keep the optional first-week route above a compact task list. Use one level of grouping for “Prepare the plan”, “Book and adjust”, and “Review the week”. Do not add a second level solely to reproduce the application's menu. Show only the current section's navigation; keep the other two sections reachable through stable top-level links. Preserve explicit current-page indication and usable narrow-screen menus.

Roles remain valuable as **entry shortcuts and action conditions**, rather than four parallel manuals:

| Reader   | Useful entry                                | Boundary to make clear                                                        |
| -------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| Owner    | Hand daily management to an Admin           | Ownership and destructive company operations remain separate responsibilities |
| Admin    | Give the team access and prepare the plan   | Invitation/membership and schedule rows are separate                          |
| Editor   | Find capacity, then book or move work       | Cannot manage members; Overview is restricted by default                      |
| Viewer   | Find next week's work                       | Cannot change bookings or enter their own holiday                             |
| Operator | Verify and hand over a working installation | Hosting/email/backups are separate from daily planning                        |

Small agencies often have one person covering several responsibilities. Task routes let that person move naturally between jobs. Do not hide content behind an audience selector: it can conceal a required handoff or become another choice before an answer.

## Layout: make the text easier to use

- **Keep the main reading column around 65–75 characters.** Start around 17px text with generous line height; test on actual screens rather than declaring one size correct.
- **Give the action priority in the opening viewport.** A title, one short orientation sentence, a relevant access condition and the first action should generally fit before a large screenshot.
- **Keep the site chrome quiet.** Stable product/help link, section navigation, one task sidebar where useful. Avoid a hero section or decorative cards on every article.
- **Use an outline when it pays for its space.** A long reference benefits from “On this page”; a 200-word task with three sections may not.
- **Use screenshots as evidence of location.** Reuse a wide overview to teach the screen once. Prefer a readable dialog or control crop for an action. Keep names and controls in text and offer the original image at full size.
- **Collapse optional explanation only.** Do not hide permissions, data loss, saving problems, a necessary step or the fact that a booking overlaps time off.
- **Keep navigation functional without scripts.** The current product deliberately supports disk-openable documentation. The samples use ordinary links and native details menus, with no fake search box.
- **Treat search as a separate product decision.** A future small static search could help a larger corpus, but it must work in the delivered artifact and preserve agreed offline behaviour. Better headings and task links are useful now.
- **Design help for narrow screens even though scheduling is desktop-oriented.** Someone can read an invitation or recovery instruction on a phone without doing mobile scheduling.

## Three alternatives to choose between

| Alternative                    | Writing and layout                                                                                    | Strongest use                                         | Cost or risk                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| **A — Task handbook**          | Short action pages, persistent compact task navigation, restrained white page                         | Everyday lookup and direct links from the application | Needs a good entry route for someone who has never planned a week                |
| **B — First-week walkthrough** | Continuous fictional example, sequential navigation, quieter warm page and an optional all-steps menu | Learning the product from an already-created company  | Can feel like a course; returning readers should not need to follow the sequence |
| **C — Answer desk**            | Question titles, immediate answer, grouped help navigation and optional detail                        | Symptom-led visits and occasional users               | Can fragment a coherent workflow and grow into a duplicate FAQ if unmanaged      |

**Choose A as the foundation.** Borrow B's controlled example for an optional introduction, and C's question wording for genuine interruptions. Publishing all three complete sets would recreate the duplication problem. They are complete here so the choice can be made from real pages rather than a mood board.

## The ten-page journey and its viewpoints

The scenario begins with an installed company and an active Owner. It ends with a feasible next-week plan that a Viewer can find. Installation and first-company creation are deliberately outside this journey; an operator is involved only if the application or email is unavailable.

| Page | Need                                                 | Acting or reading viewpoint                                         |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| 1    | Choose where to enter the weekly planning route      | Everyone; Owner can hand off daily management                       |
| 2    | Give people access and join successfully             | Owner/Admin sends; teammate accepts; operator handles email service |
| 3    | Add the people whose time is planned                 | Editor/Admin/Owner; Admin/Owner links membership                    |
| 4    | Prepare the client, project and activity             | Editor/Admin/Owner                                                  |
| 5    | Include absences before booking                      | Planner; Viewer asks for correction                                 |
| 6    | Find who has room next week                          | Everyone on Schedule; optional Overview access                      |
| 7    | Book the work                                        | Editor/Admin/Owner                                                  |
| 8    | Resolve an overloaded day                            | Planner; destination person's availability matters                  |
| 9    | Check your own week and report a correction          | Viewer, also useful to all teammates                                |
| 10   | Keep the plan current and recover from interruptions | Planner; Owner/Admin/operator only for the relevant boundary        |

The guided version uses Bruce Wayne and Diana Prince, a Wayne Enterprises Website refresh project and a Design activity. It states the example's Days-mode and working-week assumptions rather than asking readers to change their company to match a tutorial. Existing screenshots are labelled as interface references with illustrative data.

## What would establish that this is better?

Rendered pages and working links establish that the alternatives are reviewable. They do not establish that newcomers find answers faster. Before replacing the live structure, use a small comparison with people unfamiliar with the product:

- Ask a Viewer to find next week's bookings and what to do if a holiday is wrong.
- Ask a planner to find why a 75% week can still contain an overloaded day.
- Ask an Admin to invite someone who is already listed on the schedule.
- Ask someone to recover after a save message says the outcome could not be confirmed.
- Ask an operator to find the email-delivery and backup responsibilities without reading scheduling help.

Use the current site and one candidate in alternating order. Record the first destination chosen, whether the answer was found unaided, wrong turns, missing information and a plain-language explanation of the answer. Time can be recorded, but do not promise a speed improvement from this investigation. A handful of sessions is useful qualitative evidence, not statistical proof.

If A is selected, adopt it for one complete journey first, preserve old inbound URLs with redirects or retained anchors, update relevant in-app help links and stories, regenerate the committed documentation, and test the actual standalone build. Keep one canonical explanation for each rule. The design choice remains open; no production migration has been performed here.
