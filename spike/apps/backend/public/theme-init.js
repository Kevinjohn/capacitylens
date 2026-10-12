(function () {
  try {
    var preference = localStorage.getItem("capacitylens/theme") || "light";
    var dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch {
    // If storage or matchMedia is unavailable, keep the default light palette.
  }
})();
