import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import Breadcrumbs from "./Breadcrumbs.vue";
import GuideNavigation from "./GuideNavigation.vue";
import PageFeedback from "./PageFeedback.vue";
import "./custom.css";

/** Extends the documentation layout with breadcrumb, script-free guide navigation and a feedback link. */
export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "doc-before": () => [h(Breadcrumbs), h(GuideNavigation)],
      "doc-after": () => h(PageFeedback),
    });
  },
};
