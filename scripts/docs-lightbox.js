document.addEventListener("keydown", function (event) {
  if (event.key !== "Escape") return;
  document.querySelectorAll(".cl-toggle:checked").forEach(function (toggle) {
    toggle.checked = false;
  });
});
