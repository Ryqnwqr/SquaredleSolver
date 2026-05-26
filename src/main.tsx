import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import faviconUrl from "./assets/favicon.svg?url";
import App from "./App";

function applyFavicon(href: string) {
  for (const rel of ["icon", "shortcut icon"] as const) {
    let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      document.head.appendChild(link);
    }
    link.type = "image/svg+xml";
    link.href = href;
  }
  let apple = document.querySelector<HTMLLinkElement>(
    'link[rel="apple-touch-icon"]'
  );
  if (!apple) {
    apple = document.createElement("link");
    apple.rel = "apple-touch-icon";
    document.head.appendChild(apple);
  }
  apple.href = href;
}

applyFavicon(faviconUrl);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
