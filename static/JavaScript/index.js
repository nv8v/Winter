// Theme loader
const storedTheme = localStorage.getItem("selectedTheme");
if (storedTheme) {
  document.documentElement.setAttribute("data-theme", storedTheme);
} else {
  localStorage.setItem("selectedTheme", "nord");
}

// To check if the browser supports oklch ( is new browser ) 
function supportsOklch() {
  const testElement = document.createElement('div');
  testElement.style.color = 'oklch(var(--b3))';
  document.body.appendChild(testElement);
  const style = globalThis.getComputedStyle(testElement).color;
  document.body.removeChild(testElement);
  return style.indexOf('oklch') !== -1;
}

// Google analytics
globalThis.dataLayer = globalThis.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', 'G-TDHJL7ZT23');
