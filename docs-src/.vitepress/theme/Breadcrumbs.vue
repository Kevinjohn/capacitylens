<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";

// Builds a Home / Section / Page trail by finding the current page in the
// sidebar config, so the trail always matches the navigation structure.
const { page, theme } = useData();

interface Crumb {
  text: string;
  link?: string;
}

interface SidebarItem {
  text: string;
  link?: string;
  items?: SidebarItem[];
}

// Sidebar links are written without an extension ("/guide/the-schedule"). The
// site is built with cleanUrls off and read straight from disk, where only a
// server would resolve an extensionless URL — so every link this component
// emits needs the real .html on it. Directory links ("/company-login/") already
// resolve to that directory's index.html, and so do fine as they are.
const href = (link: string) => withBase(/\/$|\.\w+$|^https?:/.test(link) ? link : `${link}.html`);

// The first link anywhere in the group, including nested ones, so a group whose
// own entries are all sub-groups still gets a landing page to point at.
const firstLink = (items: SidebarItem[] = []): string | undefined => {
  for (const item of items) {
    const link = item.link ?? firstLink(item.items);
    if (link) return link;
  }
  return undefined;
};

// Depth-first walk for the page, returning the groups passed through on the way
// down. Sections nest (Security's "Review records"), and a trail built from only
// the top level would leave those pages with a bare "Home / Page".
const pathTo = (items: SidebarItem[] = [], current: string): SidebarItem[] | undefined => {
  for (const item of items) {
    if (item.link?.replace(/\/$/, "") === current) return [item];
    const below = pathTo(item.items, current);
    if (below) return [item, ...below];
  }
  return undefined;
};

const crumbs = computed<Crumb[]>(() => {
  // page.relativePath is e.g. "self-hosting/backups-and-restore.md"
  const current = "/" + page.value.relativePath.replace(/\.md$/, "").replace(/(^|\/)index$/, "$1");
  if (current === "/") return [];

  const trail: Crumb[] = [{ text: "Home", link: withBase("/") }];
  const sidebar = theme.value.sidebar;
  const found = Array.isArray(sidebar) ? pathTo(sidebar, current.replace(/\/$/, "")) : undefined;
  if (found) {
    // Everything but the last entry is a group; the last is the page itself.
    for (const group of found.slice(0, -1)) {
      const link = firstLink(group.items);
      trail.push({ text: group.text, link: link ? href(link) : undefined });
    }
    const page_ = found[found.length - 1];
    if (page_.text !== trail[trail.length - 1]?.text) trail.push({ text: page_.text });
    return trail;
  }
  trail.push({ text: page.value.title });
  return trail;
});
</script>

<template>
  <nav v-if="crumbs.length" class="breadcrumbs" aria-label="Breadcrumb">
    <ol>
      <li v-for="(crumb, i) in crumbs" :key="i">
        <a v-if="crumb.link && i < crumbs.length - 1" :href="crumb.link">{{ crumb.text }}</a>
        <span v-else aria-current="page">{{ crumb.text }}</span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.breadcrumbs {
  margin-bottom: 1.5rem;
  font-size: 0.875rem;
}
.breadcrumbs ol {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.breadcrumbs li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--vp-c-text-2);
}
.breadcrumbs li + li::before {
  content: "/";
  color: var(--vp-c-text-3);
}
.breadcrumbs a {
  color: var(--vp-c-text-2);
  text-decoration: none;
}
.breadcrumbs a:hover {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
}
.breadcrumbs span[aria-current] {
  color: var(--vp-c-text-1);
  font-weight: 500;
}
</style>
