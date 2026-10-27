import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { TooltipLayer } from "./components/TooltipLayer";
import "./styles/app.css";
import "./styles/workspace.css";
import "./styles/dialogs.css";

// All confirmations and input dialogs belong to the app's Modal components.
// The dialog plugin also replaces these browser functions with native popups.
window.alert = () => {};
window.confirm = () => false;
window.prompt = () => null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <TooltipLayer />
  </React.StrictMode>,
);
