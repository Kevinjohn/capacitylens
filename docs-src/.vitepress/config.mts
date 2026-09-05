import { readFileSync } from "node:fs";
import { defineConfig } from "vitepress";
import { imageLightbox } from "./lightbox.mts";
import { BASE } from "./base.mjs";

// The docs site. Built with `pnpm run docs:build` into the committed docs/ folder.
// Sidebar order is the reading order: sections run from "never seen it" to
// "operating it in production" to "reference".
// Escape closes an open screenshot lightbox. Opening, closing by click, and all
// the styling are pure CSS (see lightbox.mts); this one keystroke is the only
// part CSS cannot express, so it is the only script the standalone build keeps —
// hence the data-cl-keep marker that scripts/docs-standalone.mjs looks for.
//
// It is a pure enhancement, deliberately: it adds a way to close the lightbox
// and takes nothing away, so a reader with JavaScript off, or a copy of the
// pages that lost the script somewhere, still gets the click-to-close lightbox
// exactly as before. Inline rather than a bundle, because a separate .js file
// would be a network request the file:// build cannot rely on.
// Read measured source at build time; the generated page still contains this one inline script.
const escapeClosesLightbox = readFileSync(new URL("../../scripts/docs-lightbox.js", import.meta.url), "utf8").trimEnd();

export default defineConfig({
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
  // The built pages are a committed artifact in the repo-root docs/ folder,
  // not an ignored .vitepress/dist — rebuild with `pnpm run docs:build` after
  // editing anything under docs-src/.
  outDir: "../docs",
  // Off, because it cannot work in this build and was rendering as a defect:
  // VitePress emits `Last updated: <time datetime="…"></time>` and fills the
  // text in client-side, but docs-standalone.mjs strips every script — so each
  // page shipped a "Last updated:" label followed by nothing at all.
  //
  // It also made the build unreproducible: the baked timestamp is the last
  // commit touching that page's .md, so the same sources built on a CI runner
  // (where the checkout is shallow and every file maps to one ephemeral merge
  // commit) produced different bytes than the same build run locally. That is
  // what the docs workflow's freshness check exists to catch, and it cannot
  // distinguish a genuinely stale commit from this. Restoring the date means
  // rendering it at build time, not turning this back on.
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
  srcExclude: ["STYLE.md", "sso-cutover-design.md", "account-boundary.md", "README.md"],

  themeConfig: {
    siteTitle: "CapacityLens",
    outline: { level: [2, 3], label: "On this page" },

    search: { provider: "local" },

    nav: [
      { text: "Getting started", link: "/getting-started/what-is-capacitylens" },
      { text: "Using CapacityLens", link: "/guide/the-schedule" },
      { text: "Self-hosting", link: "/self-hosting/" },
      { text: "GitHub", link: "https://github.com/Kevinjohn/capacitylens" },
    ],

    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "What is CapacityLens?", link: "/getting-started/what-is-capacitylens" },
          { text: "Try the demo", link: "/getting-started/try-the-demo" },
          { text: "Choose how to install", link: "/getting-started/install" },
          { text: "First steps after installing", link: "/getting-started/first-steps" },
          { text: "Invite your team", link: "/getting-started/invite-your-team" },
          { text: "Roles and permissions", link: "/getting-started/roles-and-permissions" },
        ],
      },
      {
        text: "Using CapacityLens",
        items: [
          { text: "The schedule", link: "/guide/the-schedule" },
          { text: "People and placeholders", link: "/guide/people-and-placeholders" },
          { text: "Projects and allocations", link: "/guide/projects-and-allocations" },
          { text: "Time off", link: "/guide/time-off" },
          { text: "Settings", link: "/guide/settings" },
          { text: "Offline access", link: "/guide/offline-access" },
        ],
      },
      {
        text: "Company login (SSO)",
        items: [
          { text: "How sign-in works", link: "/company-login/" },
          { text: "Set up your company login", link: "/company-login/set-up-company-login" },
          { text: "Move from passwords to single sign-on", link: "/company-login/move-to-single-sign-on" },
        ],
      },
      {
        text: "Self-hosting",
        items: [
          { text: "Before you start", link: "/self-hosting/" },
          { text: "Install with Docker", link: "/self-hosting/install-with-docker" },
          { text: "Install without Docker", link: "/self-hosting/install-without-docker" },
          { text: "Configuration", link: "/self-hosting/configuration" },
          { text: "TLS and networking", link: "/self-hosting/tls-and-networking" },
          { text: "Backups and restore", link: "/self-hosting/backups-and-restore" },
          { text: "Upgrades", link: "/self-hosting/upgrades" },
          { text: "Monitoring and health checks", link: "/self-hosting/monitoring" },
          { text: "When something goes wrong", link: "/self-hosting/incidents" },
        ],
      },
      {
        text: "Security and privacy",
        items: [
          { text: "Security overview", link: "/security/" },
          { text: "Privacy", link: "/security/privacy" },
          { text: "Reviews and compliance", link: "/security/reviews" },
          {
            // Not collapsed: VitePress expands a collapsed group client-side,
            // and the shipped pages have no JavaScript (see docs-standalone.mjs),
            // so a collapsed group would put these six pages behind a control
            // that can never open.
            text: "Review records",
            items: [
              { text: "Threat model", link: "/security/threat-model" },
              { text: "OWASP ASVS 5.0.0 mapping", link: "/security/owasp-asvs-5.0.0" },
              { text: "Control inventories", link: "/security/control-inventories" },
              { text: "Security review — 2026-08-18", link: "/security/security-review-2026-08-18" },
              { text: "Mutation-test security review — 2026-07-15", link: "/security/mutation-review-2026-07-15" },
              { text: "Mutation-test review — 2026-07-18", link: "/security/mutation-review-2026-07-18" },
            ],
          },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Glossary", link: "/reference/glossary" },
          { text: "Development guide", link: "/reference/development" },
        ],
      },
    ],

    docFooter: { prev: "Previous", next: "Next" },

    socialLinks: [{ icon: "github", link: "https://github.com/Kevinjohn/capacitylens" }],

    footer: {
      message: "CapacityLens is open source under AGPL-3.0.",
      copyright: "Screenshots are captured from the running app — see docs-src/STYLE.md in the repository.",
    },
  },
});
