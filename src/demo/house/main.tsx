import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import "./house.css";
import { HouseDemo } from "./HouseDemo";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HouseDemo />
  </StrictMode>,
);
