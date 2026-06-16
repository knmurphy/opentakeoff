import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./styles/tokens.css";
import "./styles/app.css";
import TakeoffCanvas from "./pages/TakeoffCanvas.jsx";

// Client-only SPA. There is no backend in the default build — the canvas runs
// entirely in the browser and persists to IndexedDB / localStorage.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<TakeoffCanvas />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
