<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";

const { page, theme } = useData();

interface SidebarItem {
  text: string;
  link?: string;
  items?: SidebarItem[];
}

const href = (link: string) => withBase(/\/$|\.\w+$|^https?:/.test(link) ? link : `${link}.html`);

const current = computed(() => "/" + page.value.relativePath.replace(/\.md$/, "").replace(/(^|\/)index$/, "$1"));

const isCurrent = (link: string) => link.replace(/\/$/, "") === current.value.replace(/\/$/, "");

const items = computed<SidebarItem[]>(() => {
  const configured = theme.value.sidebar;
  if (Array.isArray(configured)) return configured;

  return (
    Object.entries(configured ?? {})
      .sort(([left], [right]) => right.length - left.length)
      .find(([prefix]) => current.value.startsWith(prefix.replace(/\/$/, "")))?.[1] ?? []
  );
});

const guide = computed(() => items.value.find((item) => item.items?.length));
</script>

<template>
  <div v-if="guide" class="guide-links">
    <details class="guide-navigation">
      <summary>In this guide: {{ guide.text }}</summary>
      <ul>
        <li v-for="item in guide.items" :key="item.text">
          <a
            v-if="item.link"
            :href="href(item.link)"
            :aria-current="isCurrent(item.link) ? 'page' : undefined"
          >{{ item.text }}</a>
          <span v-else>{{ item.text }}</span>
          <ul v-if="item.items">
            <li v-for="child in item.items" :key="child.text">
              <a
                v-if="child.link"
                :href="href(child.link)"
                :aria-current="isCurrent(child.link) ? 'page' : undefined"
              >{{ child.text }}</a>
            </li>
          </ul>
        </li>
      </ul>
    </details>
  </div>
</template>
