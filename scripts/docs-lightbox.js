document.addEventListener("keydown", function (event) {
  if (event.key !== "Escape" && event.key !== "Tab") return;
  document.querySelectorAll(".cl-toggle:checked").forEach(function (toggle) {
    toggle.checked = false;
  });
});

if (typeof location !== "undefined" && location.protocol === "file:") {
  document.querySelector?.(".cl-standalone-not-found a")?.setAttribute("href", "index.html");
}
