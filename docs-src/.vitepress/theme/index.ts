import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import Breadcrumbs from "./Breadcrumbs.vue";
import GuideNavigation from "./GuideNavigation.vue";
import "./custom.css";

/** Extends the documentation layout with breadcrumb and script-free guide navigation. */
export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "doc-before": () => [h(Breadcrumbs), h(GuideNavigation)],
    });
  },
};
