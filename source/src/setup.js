// setup.js: DOM-Elemente, Fehleranzeige und WebGL2-Kontext
const canvas = document.getElementById("scene");
const errBanner = document.getElementById("err-banner");
const chapterEl = document.getElementById("chapter-label");
const btnToggle = document.getElementById("btn-toggle");
const btnAudio = document.getElementById("btn-audio");

function showError(msg) {
  errBanner.style.display = "block";
  errBanner.textContent = msg;
}

const gl = canvas.getContext("webgl2", { antialias: false, powerPreference: "high-performance" });
if (!gl) {
  showError("WebGL2 wird von diesem Browser/Gerät nicht unterstützt.");
  return;
}
