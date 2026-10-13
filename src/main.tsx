import React from "react";
import ReactDOM from "react-dom/client";
import App from "./SessionApp";
import "./style.css";
import { ConfirmationProvider } from "./ConfirmationDialog";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfirmationProvider>
      <App />
    </ConfirmationProvider>
  </React.StrictMode>,
);
