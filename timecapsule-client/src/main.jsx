import React from "react";
import ReactDOM from "react-dom/client";
// The two typefaces, bundled with the site (no requests to a font service):
// Archivo with its width axis (for the wide headings), Newsreader with weights
// only (its optical sizes would more than double the download).
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/newsreader";
import "./index.css";
import App from "./App";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
