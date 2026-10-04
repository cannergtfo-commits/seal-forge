# Seal Forge

Dark-fantasy card duel. Five seals, twenty life, and Polygon card NFTs.

The table, packs, and ranked queue need the Node server. A static host can serve the pictures, not the match. Local play uses the built-in PGLite database when `DATABASE_URL` is not set.

## Download and install

1. Download the repository zip from [github.com/cannergtfo-commits/seal-forge](https://github.com/cannergtfo-commits/seal-forge) (Code → Download ZIP), or the zip on a `v*` release.
2. Unzip it. Keep the folder. The installer does not copy the game somewhere else.
3. Install [Node.js 22 LTS](https://nodejs.org) if it is not already installed.
4. Run the installer for your system:

Windows, from the unzipped folder:

```powershell
powershell -ExecutionPolicy Bypass -File installer\install.ps1
```

macOS or Linux:

```bash
bash installer/install.sh
```

That installs the files, puts a launcher on the desktop, and opens http://127.0.0.1:8080. Later launches can use the desktop shortcut or `installer/SealForge.cmd` / `installer/start.sh`.

A tagged `v*` push also builds `seal-forge-<tag>.zip` and attaches it to a GitHub Release.

## What this does not package

- Polygon wallet actions still need the deployed contracts and a wallet. Offline install does not mint cards.
- The `android/` project is a shell, not a signed Play Store build. There is no APK in the release zip.
- Ranked play against other people needs this server reachable by those players, not only by localhost.

## Develop

```bash
npm install
npm run dev
```
