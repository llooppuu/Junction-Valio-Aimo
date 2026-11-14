import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/figtree/latin-400.css";
import "@fontsource/figtree/latin-500.css";
import "@fontsource/figtree/latin-600.css";
import "@fontsource/figtree/latin-700.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/source-serif-4/latin-400.css";
import { App } from "./App";
import { LanguageProvider } from "./lib/i18n";
import "./styles.css";
import "./redesign.css";
import "./patterns.css";
import "./brand.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("The #root element is missing from index.html.");
}

createRoot(root).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
);
