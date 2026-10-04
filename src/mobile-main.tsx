import { createRoot } from "react-dom/client";
import { VeilApp } from "@/components/veil/veil-app";
import "./styles.css";

window.__SEAL_APK__ = true;

const root = document.getElementById("root");
if (root) createRoot(root).render(<VeilApp />);
