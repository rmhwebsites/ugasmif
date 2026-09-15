// Applies the saved (or system) theme before first paint to avoid a flash.
// Loaded synchronously as the first element in <body>.
(function () {
  try {
    var m = localStorage.getItem("smif-theme");
    var r =
      m === "light" || m === "dark"
        ? m
        : window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    document.documentElement.dataset.theme = r;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
