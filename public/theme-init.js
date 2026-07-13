(function () {
  try {
    var preference = localStorage.getItem('capacitylens/theme') || localStorage.getItem('floaty/theme') || 'light'
    var dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  } catch (_) {
    // Storage/matchMedia unavailable — leave the default light palette.
  }
})()
