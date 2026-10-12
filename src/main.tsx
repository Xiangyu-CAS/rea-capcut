import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
void document.fonts
  .load('16px \"Noto Sans SC\"')
  .catch(() => [])
  .finally(() => {
    ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
  });
