import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import { DoorsDrawDemo } from "./DoorsDrawDemo";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DoorsDrawDemo />
  </StrictMode>,
);
