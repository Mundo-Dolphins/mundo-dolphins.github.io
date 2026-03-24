(function () {
  var STORAGE_KEY = "md-article-font-scale";
  var READING_MODE_KEY = "md-article-reading-mode";
  var MIN_SCALE = 0.9;
  var MAX_SCALE = 1.35;
  var STEP = 0.05;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function loadScale() {
    var raw = localStorage.getItem(STORAGE_KEY);
    var parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return 1;
    }
    return clamp(parsed, MIN_SCALE, MAX_SCALE);
  }

  function saveScale(scale) {
    localStorage.setItem(STORAGE_KEY, scale.toFixed(2));
  }

  function loadReadingMode() {
    return localStorage.getItem(READING_MODE_KEY) === "true";
  }

  function saveReadingMode(enabled) {
    localStorage.setItem(READING_MODE_KEY, enabled ? "true" : "false");
  }

  function formatScale(scale) {
    return Math.round(scale * 100) + "%";
  }

  function buildControls(content) {
    if (content.dataset.fontControlsReady === "true") {
      return;
    }

    var controls = document.createElement("div");
    controls.className = "font-size-controls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Tamaño de letra");

    var decreaseBtn = document.createElement("button");
    decreaseBtn.type = "button";
    decreaseBtn.className = "font-size-controls__button";
    decreaseBtn.setAttribute("aria-label", "Disminuir tamaño de letra");
    decreaseBtn.textContent = "A-";

    var value = document.createElement("span");
    value.className = "font-size-controls__value";
    value.setAttribute("aria-live", "polite");

    var increaseBtn = document.createElement("button");
    increaseBtn.type = "button";
    increaseBtn.className = "font-size-controls__button";
    increaseBtn.setAttribute("aria-label", "Aumentar tamaño de letra");
    increaseBtn.textContent = "A+";

    var readingBtn = document.createElement("button");
    readingBtn.type = "button";
    readingBtn.className = "font-size-controls__button font-size-controls__button--reading";
    readingBtn.setAttribute("aria-label", "Activar modo lectura");

    var scale = loadScale();
    var readingMode = loadReadingMode();

    function apply() {
      content.style.fontSize = formatScale(scale);
      value.textContent = formatScale(scale);
      decreaseBtn.disabled = scale <= MIN_SCALE;
      increaseBtn.disabled = scale >= MAX_SCALE;
      document.body.classList.toggle("reading-mode", readingMode);
      readingBtn.textContent = readingMode ? "Salir lectura" : "Modo lectura";
      readingBtn.setAttribute("aria-pressed", readingMode ? "true" : "false");
    }

    decreaseBtn.addEventListener("click", function () {
      scale = clamp(scale - STEP, MIN_SCALE, MAX_SCALE);
      saveScale(scale);
      apply();
    });

    increaseBtn.addEventListener("click", function () {
      scale = clamp(scale + STEP, MIN_SCALE, MAX_SCALE);
      saveScale(scale);
      apply();
    });

    readingBtn.addEventListener("click", function () {
      readingMode = !readingMode;
      saveReadingMode(readingMode);
      apply();
    });

    controls.appendChild(decreaseBtn);
    controls.appendChild(value);
    controls.appendChild(increaseBtn);
    controls.appendChild(readingBtn);

    content.parentNode.insertBefore(controls, content);
    content.dataset.fontControlsReady = "true";

    apply();
  }

  function init() {
    var articleContents = document.querySelectorAll(".post .post__content");
    articleContents.forEach(buildControls);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
