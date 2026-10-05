export function isApk(): boolean {
  return typeof window !== "undefined" && window.__SEAL_APK__ === true;
}

export type SealVault = {
  read: () => string;
  write: (value: string) => void;
  clear: () => void;
  secure: (on: boolean) => void;
  saveFile: (name: string, text: string) => boolean;
  request?: (method: string, path: string, body: string) => string;
};

declare global {
  interface Window {
    __SEAL_APK__?: boolean;
    __SEAL_API__?: string;
    SealVault?: SealVault;
  }
}
