---
title: First steps after installing
description: Claim the first Owner account, create your company and find your way around the schedule.
---

# First steps after installing

Once you've finished either [installation route](/getting-started/install), this page
covers the first few minutes inside the app: claiming the first [Owner](/reference/glossary)
account, creating your company and getting oriented on the schedule.

## Claim the Owner account

Open CapacityLens through the public URL you configured during installation. With an
empty database, the sign-in page asks for your name, email, password and the setup token
from your `.env` file.

After you submit the form, self-registration closes. Nobody else can join the instance
without an [invite](/reference/glossary), and every later visit shows the ordinary
sign-in screen.

::: warning
Do not rely on `admin@admin.admin`. CapacityLens uses that bootstrap account only during
local development and switches it off for a production install. There is no default
production password: the Owner account you create here is the one that matters.
:::

## Create your company

Enter your company name when CapacityLens asks. This also creates its built-in
"Internal" client and your Owner [membership](/reference/glossary).

![Choose a company screen listing Wayne Enterprises with an Owner badge](../screenshots/flows/choose-company.jpg)

## Sign in

Every visit after you've created the Owner account shows the plain sign-in screen: email
and password.

![CapacityLens sign-in screen with email and password fields](../screenshots/flows/sign-in.jpg)

## The welcome message

Once per device, CapacityLens shows a short orientation explaining what it is — and what
it isn't. It's worth reading once: it sets expectations that CapacityLens plans people,
not paperwork, and it won't show again on that device.

![Welcome to CapacityLens dialog explaining it is a resourcing tool, not a project management tool](../screenshots/flows/welcome.jpg)

## Finding your way around the schedule

After the welcome message, you land on [the schedule](/guide/the-schedule) — the one
screen the whole product is built around. On a fresh install it's empty, with a Getting
Started panel prompting you to add clients, projects and people before you drag out any
allocations.

![The Schedule view with people grouped by discipline, allocation bars, utilisation and a holiday block](../screenshots/flows/schedule.jpg)

A few things worth knowing before you start adding data:

- People are grouped by [discipline](/reference/glossary) down the left.
- Allocation bars span the weeks a [person](/reference/glossary) is booked, and can be tentative, confirmed or
  completed.
- [Utilisation](/reference/glossary) percentages update live as you drag allocations around.
- Time off — holiday, sick, unpaid — sits on the same canvas as work, so capacity is
  always honest.

See [The schedule](/guide/the-schedule) for the full walkthrough of the view, and [People
and placeholders](/guide/people-and-placeholders) for adding your team.

## What's next

[Invite your team](/getting-started/invite-your-team) so the rest of your studio can sign
in too — or go straight to [The schedule](/guide/the-schedule) if you're setting things up
solo first.
