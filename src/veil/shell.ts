export function isApk(): boolean {
  return typeof window !== "undefined" && window.__SEAL_APK__ === true;
}

export type SealVault = {
  read: () => string;
  write: (value: string) => void;
  clear: () => void;
  secure: (on: boolean) => void;
  saveFile: (name: string, text: string) => boolean;
};

declare global {
  interface Window {
    __SEAL_APK__?: boolean;
    SealVault?: SealVault;
  }
}
