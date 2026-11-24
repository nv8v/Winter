require.config({
  paths: {
    "vs": "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs",
  },
});

// Monaco Editor
require(["vs/editor/editor.main"], () => {
  const isnord = localStorage.getItem("selectedTheme") === "nord";
  const vsTheme = isnord ? "vs-light" : "vs-dark";
  globalThis.editor = monaco.editor.create(document.getElementById("editor"), {
    language: "javascript",
    theme: vsTheme,
    minimap: { enabled: false },
  });
  const editorElement = document.getElementById("editor");
  if (editorElement && "ResizeObserver" in globalThis) {
    const resizeObserver = new ResizeObserver(() => editor.layout());
    resizeObserver.observe(editorElement);
  } else {
    globalThis.addEventListener("resize", () => editor.layout());
  }
  document.getElementById("editor-loading").style.display = "none";
});
