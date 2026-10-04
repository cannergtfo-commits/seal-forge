import { createRoot } from "react-dom/client";
import { VeilApp } from "@/components/veil/veil-app";
import "./styles.css";

window.__SEAL_APK__ = true;

function localAsset(value: string) {
  return value.startsWith("/assets/") ? `file:///android_asset${value}` : value;
}

function retarget(proto: object, prop: string) {
  const desc = Object.getOwnPropertyDescriptor(proto, prop);
  if (!desc?.set) return;
  Object.defineProperty(proto, prop, {
    configurable: true,
    enumerable: desc.enumerable,
    get: desc.get,
    set(value: unknown) {
      desc.set!.call(this, typeof value === "string" ? localAsset(value) : value);
    },
  });
}

retarget(HTMLImageElement.prototype, "src");
retarget(HTMLVideoElement.prototype, "src");
retarget(HTMLVideoElement.prototype, "poster");
retarget(HTMLAudioElement.prototype, "src");

const setAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name: string, value: string) {
  if ((name === "src" || name === "poster") && value.startsWith("/assets/")) value = localAsset(value);
  return setAttribute.call(this, name, value);
};

function boot() {
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<VeilApp />);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
