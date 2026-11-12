# Documentation sources and observed patterns

Inspected **10 November 2026**. Ten open-source projects were considered, with three supplementary content-design resources. These notes describe particular pages, not an accessibility certification, a complete audit of each site, or measured reader outcomes. Public sites and repositories can change independently.

## Closest product-documentation examples

### Immich

[Quick start](https://docs.immich.app/overview/quick-start/) · [Sharing](https://docs.immich.app/features/sharing/) · [Quick-start source](https://github.com/immich-app/immich/blob/main/docs/docs/overview/quick-start.mdx) · [Sharing source](https://github.com/immich-app/immich/blob/main/docs/docs/features/sharing.md)

The quick start defines prerequisites, takes a single setup path, then asks the reader to try the web application. The page separates setup from later destinations. The inspected desktop layout has left navigation, a central article, a right outline and a visible skip link in the document structure. Sharing distinguishes interfaces within its subject.

**Transfer:** one controlled route followed by focused tasks. **Limit:** this is a larger application with substantial hosting and mobile detail; its complete sidebar is not a model for CapacityLens.

### Actual Budget

[Docs home](https://actualbudget.org/docs/) · [Starting Fresh](https://actualbudget.org/docs/getting-started/starting-fresh/) · [Budgeting](https://actualbudget.org/docs/budgeting/) · [Starting Fresh source](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/getting-started/starting-fresh.md)

Starting Fresh follows a budgeting workflow and links to specific operations. The desktop layout separates topic navigation from the article's outline. The article includes substantial background and recommendations as well as actions.

**Transfer:** teach the recurring workflow and let detailed operations have clear destinations. **Limit:** its conceptual depth can make a first-use article long. Borrow the workflow, then edit to CapacityLens's narrower need.

### Penpot

[First Steps](https://help.penpot.app/user-guide/first-steps/) · [Cloud or Self-host](https://help.penpot.app/user-guide/first-steps/cloud-selfhost/) · [Public documentation repository](https://github.com/penpot/penpot-docs)

First Steps is a short list of named destinations, each paired with a description of what the reader gets. It does not reproduce the contents of those destinations. The linked public repository is archived/read-only, so its maintenance arrangement is not evidence of a currently active docs workflow.

**Transfer:** a compact routing page. **Limit:** routing alone does not answer a task; avoid an extra chooser before every useful action.

### Home Assistant

[Documentation](https://www.home-assistant.io/docs/) · [Automations](https://www.home-assistant.io/docs/automation/) · [Dashboards](https://www.home-assistant.io/dashboards/) · [Automation source](https://github.com/home-assistant/home-assistant.io/blob/current/source/_docs/automation.markdown) · [Dashboard source](https://github.com/home-assistant/home-assistant.io/blob/current/source/dashboards/index.markdown)

The automation page separately routes readers to a first tutorial, explanation, references and troubleshooting. Plain examples introduce the subject. The public source shows the article's headings and links alongside the rendered site.

**Transfer:** distinct destinations for first use, depth and recovery. **Limit:** the deep topic tree serves a much broader product; it would add unnecessary weight to a small scheduler.

### BookStack

[User docs](https://www.bookstackapp.com/docs/user/) · [Getting Around and Finding Content](https://www.bookstackapp.com/docs/user/getting-around/) · [Searching Content](https://www.bookstackapp.com/docs/user/searching/) · [Former website repository](https://github.com/BookStackApp/website) · [Current site-source link](https://codeberg.org/bookstack/website)

Getting Around describes several routes to content, including breadcrumbs and neighbouring pages. The inspected user index is a long dated list of article excerpts; it is less attractive as a small product's first-use landing page. The old GitHub site repository is archived; the live footer points to Codeberg. The current source body was not independently audited here.

**Transfer:** support different entry paths and contextual links. **Limit:** documentation software has different search and organisation needs from a scheduling product.

## Structural examples from developer documentation

### Astro

[Getting started](https://docs.astro.build/en/getting-started/) · [Build a blog](https://docs.astro.build/en/tutorial/0-introduction/) · [About the tutorial](https://docs.astro.build/en/tutorial/0-introduction/1/) · [Recipes](https://docs.astro.build/en/recipes/) · [Navigation source](https://github.com/withastro/docs/blob/main/astro.sidebar.ts)

The entry page distinguishes a guided tour from starting a project. Recipes are focused tasks; the tutorial is a continuous worked project. Source navigation separates Tutorial, Guides and Reference and groups secondary material. Tutorial progress checklists are optional, with their browser-storage behaviour explained.

**Transfer:** separate learning from lookup and let readers skip known setup. **Limit:** no need for curriculum tracking, ecosystem categories or developer prerequisites in everyday CapacityLens help.

### Django

[Documentation home](https://docs.djangoproject.com/en/5.2/) · [What to read next](https://docs.djangoproject.com/en/5.2/intro/whatsnext/) · [Source](https://github.com/django/django/blob/main/docs/intro/whatsnext.txt)

The documentation explicitly explains the different jobs of tutorials, topic guides, reference and how-to guides. The how-to description is centred on a particular problem rather than listing every API detail. Version 5.2 was the inspected published version; the main-branch source may continue evolving.

**Transfer:** identify a page's job and link to other kinds of help. **Limit:** copying its framework-scale reference hierarchy would overcomplicate a simple product.

### Godot

[Documentation introduction](https://docs.godotengine.org/en/stable/about/introduction.html) · [Step by step](https://docs.godotengine.org/en/latest/getting_started/step_by_step/) · [Step-by-step source](https://github.com/godotengine/godot-docs/blob/master/getting_started/step_by_step/index.rst)

The introduction says the manual can be consulted in any order, distinct from Getting Started. Step by step builds foundations for a complete project; its source uses a clear ordered contents list. Stable and latest are distinct version routes, so individual details should not be treated as one frozen publication.

**Transfer:** an optional coherent route plus a browsable manual. **Limit:** avoid its extensive prerequisites and engine/class-reference apparatus.

### Frappe

[Navigation](https://docs.frappe.io/framework/user/en/desk/navigation) · [Desktop](https://docs.frappe.io/framework/user/en/desk/navigation/desktop) · [Public tutorial source](https://github.com/frappe/frappe_docs/blob/master/frappe_docs/www/docs/user/en/tutorial/create-a-site.md)

The desktop guide names interface regions, then describes navigation and permission-dependent destinations. Its framework sidebar is extensive. The linked public tutorial source is an example of repository-authored procedural content, not a verified source match for the current desktop page.

**Transfer:** tie language and screenshots to visible controls. **Limit:** its app/module hierarchy and installation depth are not appropriate everyday navigation for CapacityLens.

### Caddy

[Getting Started](https://caddyserver.com/docs/getting-started) · [Reverse-proxy quick start](https://caddyserver.com/docs/quick-starts/reverse-proxy) · [Public website repository](https://github.com/caddyserver/website)

The reverse-proxy page states assumptions, gives a minimal operation and follows it with a direct result check. It links onward to detailed options. The longer introductory tutorial explores the system rather than serving as a quick lookup.

**Transfer:** separate a minimal working task from explanation, and verify its result. **Limit:** this is operator documentation. A guessed deep source-file URL did not resolve, so no exact current article-source match is claimed.

## Supplementary editorial references

- [Diátaxis: Start here](https://www.diataxis.fr/start-here/), [map](https://www.diataxis.fr/map/) and [application](https://www.diataxis.fr/application/): distinguish reader needs and improve a small part pragmatically. This is a documentation framework, not a product comparison or reader-outcome study.
- [Write the Docs: Documentation principles](https://www.writethedocs.org/guide/writing/docs-principles/): useful professional guidance about discoverability, appropriate formats and maintenance. It is practice guidance, not proof that a particular navigation will work here.
- [GOV.UK: Understand content design](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/plan-manage-content/understand-content-design/): begins with a user need and the appropriate scope/location for content. Government-service publishing differs from open-source product help; used as a supplementary editing lens.

## CapacityLens evidence

The comparison used [STYLE.md](../docs-src/STYLE.md), [DECISIONS.md](../DECISIONS.md), [navigation configuration](../docs-src/.vitepress/config.mts), [standalone generation](../scripts/docs-standalone.mjs), the Owner/Admin/everyday guides, and representative current controls in [English UI messages](../apps/frontend/messages/en.json), [access policy](../packages/shared/src/domain/access.ts), [invitation acceptance](../apps/frontend/src/components/invites/InviteAccept.tsx), and [limited-access screens](../apps/frontend/src/auth/AccessScreens.tsx).

The [published Schedule page](https://kevinjohn.github.io/capacitylens/using/read-the-schedule.html) was also inspected visually. Published pages can lag repository main; repository source and owning components governed the sample instructions. No live customer data or production writes were used.
