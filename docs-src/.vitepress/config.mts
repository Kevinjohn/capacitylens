import { readFileSync } from "node:fs";
import { defineConfig } from "vitepress";
import { imageLightbox } from "./lightbox.mts";
import { BASE } from "./base.mjs";
import { generateDocumentationComponentId } from "./generateDocumentationComponentId.mts";
import { ports } from "../../scripts/ports.mjs";

// Standalone pages retain this inline keyboard handler because file:// copies cannot depend on a separate bundle.
// Click-to-close still works through CSS when JavaScript is unavailable.
const escapeClosesLightbox = readFileSync(new URL("../../scripts/docs-lightbox.js", import.meta.url), "utf8").trimEnd();

// VitePress is Vite, so `docs:dev` would default to 5173 and `docs:preview` to 4173, the exact
// ports the application dev server and the E2E suite bind. Writing documentation would then quietly
// block a test run in another worktree, and the collision surfaces as an unrelated E2E failure.
// Pin both to the documentation lane instead (scripts/ports.mjs).
const lanePorts = ports();

const usingSidebar = [
  {
    text: "Day-to-day usage",
    items: [
      { text: "Start here", link: "/using/" },
      { text: "Join your team", link: "/using/join-your-team" },
      { text: "Plan work as an Editor", link: "/using/editor" },
      { text: "Check the plan as a Viewer", link: "/using/viewer" },
      {
        text: "Page guide",
        items: [
          { text: "Schedule", link: "/using/read-the-schedule" },
          { text: "Overview", link: "/using/overview" },
          { text: "Resources", link: "/using/resources" },
          { text: "Disciplines", link: "/using/disciplines" },
          { text: "Clients and projects", link: "/using/projects" },
          { text: "Activities", link: "/using/activities" },
          { text: "Time off", link: "/using/time-off" },
        ],
      },
      {
        text: "When you need it",
        items: [
          { text: "Schedule and change work", link: "/using/schedule-work" },
          { text: "Settings", link: "/using/settings" },
          { text: "Help", link: "/using/help" },
          { text: "Account", link: "/using/account" },
          { text: "Team & access", link: "/using/team-access" },
          { text: "FAQ", link: "/using/faq" },
        ],
      },
    ],
  },
];

const ownerSidebar = [
  {
    text: "Owner setup",
    items: [
      { text: "Start here", link: "/owner/" },
      { text: "Access your company", link: "/owner/create-your-company" },
      { text: "Appoint an Admin", link: "/owner/appoint-an-admin" },
      { text: "Owner responsibilities", link: "/owner/responsibilities" },
      { text: "Roles and permissions", link: "/getting-started/roles-and-permissions" },
      { text: "Owner FAQ", link: "/owner/faq" },
    ],
  },
];

const adminSidebar = [
  {
    text: "Admin and settings",
    items: [
      { text: "Start here", link: "/admin/" },
      { text: "Invite teammates", link: "/admin/invite-teammates" },
      { text: "Add people to the schedule", link: "/admin/add-people" },
      { text: "Choose company settings", link: "/admin/company-settings" },
      { text: "Prepare clients and work", link: "/admin/prepare-work" },
      { text: "Make the first booking", link: "/admin/first-booking" },
      { text: "Ongoing administration", link: "/admin/ongoing-administration" },
      { text: "Diagnostics", link: "/admin/diagnostics" },
      { text: "Admin FAQ", link: "/admin/faq" },
    ],
  },
];

const selfHostingSidebar = [
  {
    text: "Install and run",
    items: [
      { text: "Start here", link: "/self-hosting/" },
      { text: "Install CapacityLens", link: "/self-hosting/install" },
      { text: "Deploy on a managed host", link: "/self-hosting/managed-vps/" },
      { text: "Install without Docker", link: "/self-hosting/install-without-docker" },
      { text: "Install with Docker", link: "/self-hosting/install-with-docker" },
      { text: "Configuration", link: "/self-hosting/configuration" },
      { text: "TLS and networking", link: "/self-hosting/tls-and-networking" },
      { text: "Verify and hand over", link: "/self-hosting/verify-and-hand-over" },
      { text: "Backups and restore", link: "/self-hosting/backups-and-restore" },
      { text: "Upgrades", link: "/self-hosting/upgrades" },
      { text: "Monitoring and health checks", link: "/self-hosting/monitoring" },
      {
        text: "Company login",
        link: "/company-login/",
        items: [
          { text: "Set up Google or Microsoft sign-in", link: "/company-login/set-up-company-login" },
          { text: "Require company sign-in", link: "/company-login/move-to-single-sign-on" },
        ],
      },
      { text: "Recover a blocked ownership transfer", link: "/self-hosting/ownership-transfer-recovery" },
      { text: "When something goes wrong", link: "/self-hosting/incidents" },
      { text: "Install and operations FAQ", link: "/self-hosting/faq" },
    ],
  },
];

const referenceSidebar = [
  {
    text: "Reference",
    items: [
      { text: "Glossary", link: "/reference/glossary" },
      { text: "Security and privacy", link: "/security/" },
      { text: "Privacy", link: "/security/privacy" },
      {
        text: "Reviews and compliance",
        link: "/security/reviews",
        items: [
          { text: "Security review 2026-08-18", link: "/security/reviews/security-review-2026-08-18" },
          { text: "Security review 2026-07-14", link: "/security/reviews/security-review-2026-07-14" },
          { text: "Mutation-test review 2026-07-15", link: "/security/reviews/mutation-review-2026-07-15" },
          { text: "Mutation-test review 2026-07-18", link: "/security/reviews/mutation-review-2026-07-18" },
        ],
      },
      { text: "Threat model", link: "/security/threat-model" },
      { text: "OpenSSF Baseline assessment", link: "/security/OpenSSF-best-practices-dev" },
      { text: "Control inventories", link: "/security/control-inventories" },
      { text: "Node 26 discovery", link: "/reference/node26-discovery" },
      { text: "How it is tested", link: "/reference/how-it-is-tested" },
      { text: "Philosophy", link: "/reference/philosophy" },
      { text: "Open source and contributing", link: "/open-source" },
    ],
  },
];

const introductionSidebar = [
  {
    text: "Start here",
    items: [
      { text: "What is CapacityLens?", link: "/getting-started/what-is-capacitylens" },
      { text: "Quick start", link: "/getting-started/quick-start" },
      { text: "Try the demo", link: "/getting-started/try-the-demo" },
      { text: "How it compares", link: "/getting-started/how-it-compares" },
    ],
  },
];

/** Configures the standalone documentation site, preserving disk-openable links and deterministic build output. */
export default defineConfig({
  vue: {
    features: {
      componentIdGenerator: generateDocumentationComponentId,
    },
  },
  vite: {
    server: { port: lanePorts.docsDev, strictPort: true },
    preview: { port: lanePorts.docsPreview, strictPort: true },
  },
  head: [["script", { "data-cl-keep": "" }, escapeClosesLightbox]],
  title: "CapacityLens",
  description:
    "Documentation for CapacityLens — a self-hosted helicopter view of who is busy, free, or overworked, week by week.",
  lang: "en-GB",
  base: BASE,
  // Keep real .html extensions in links: the postbuild step (scripts/docs-standalone.mjs)
  // turns the build into standalone pages that open straight from disk, where
  // extensionless URLs would need a server to rewrite them.
  cleanUrls: false,
  outDir: "../docs",
  // Standalone pages omit the client bundle that renders lastUpdated; Git timestamps also differ between full and shallow checkouts.
  lastUpdated: false,

  // Deliberately light-only: plain white page, dark text, like classic docs sites.
  appearance: false,

  // Code blocks are the one dark element on the light page: terminals and code
  // read as terminals. The background/label colours to match live in
  // theme/custom.css (--vp-code-block-bg and friends).
  // Screenshots get a JavaScript-free click-to-enlarge lightbox; see lightbox.mts
  // for why it has to be build-time markup rather than a library.
  markdown: { theme: "github-dark", config: imageLightbox },

  // Internal records that live in docs-src/ but are not part of the site.
  srcExclude: ["STYLE.md", "decisions/**", "README.md"],

  themeConfig: {
    siteTitle: "CapacityLens",
    outline: { level: [2, 3], label: "On this page" },

    search: { provider: "local" },

    nav: [
      { text: "What is CapacityLens?", link: "/getting-started/what-is-capacitylens" },
      { text: "Quick start", link: "/getting-started/quick-start" },
      { text: "Which one are you?", link: "/#which-one-are-you" },
      { text: "GitHub", link: "https://github.com/Kevinjohn/capacitylens" },
    ],

    sidebar: {
      "/using/": usingSidebar,
      "/owner/": ownerSidebar,
      "/getting-started/roles-and-permissions": ownerSidebar,
      "/admin/": adminSidebar,
      "/self-hosting/": selfHostingSidebar,
      "/company-login/": selfHostingSidebar,
      "/reference/": referenceSidebar,
      "/security/": referenceSidebar,
      "/open-source": referenceSidebar,
      "/getting-started/": introductionSidebar,
    },

    docFooter: { prev: "Previous", next: "Next" },

    socialLinks: [{ icon: "github", link: "https://github.com/Kevinjohn/capacitylens" }],

    footer: {
      message: "CapacityLens is open source under AGPL-3.0.",
    },
  },
});
