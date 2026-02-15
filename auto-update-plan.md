# Auto-Update Implementation Plan

## Overview
Add Tauri Updater plugin to enable in-app update prompts for Windows, macOS, and Linux (AppImage).

## Changes Required

### 1. Add Dependencies
**`src-tauri/Cargo.toml`**
- Add `tauri-plugin-updater`

**`package.json`**
- Add `@tauri-apps/plugin-updater`

### 2. Configure Tauri
**`src-tauri/tauri.conf.json`**
- Add updater plugin config with GitHub endpoint
- Enable updater capability
- Configure pubkey for signature verification

### 3. Generate Signing Keys
- Run `tauri signer generate -w ~/.tauri/crabdrop.key`
- Add private key as GitHub secret `TAURI_SIGNING_PRIVATE_KEY`
- Add password as GitHub secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Add public key to `tauri.conf.json`

### 4. Update GitHub Workflow
**`.github/workflows/release.yml`**
- Add signing secrets to tauri-action
- Add step to generate `latest.json` manifest
- Upload manifest to release assets

### 5. Frontend Update UI
**`src/`** (new file or integrate into existing)
- Check for updates on app launch
- Show notification/modal when update available
- "Update Now" → download + install
- "Later" → dismiss

### 6. Rust Backend
**`src-tauri/src/lib.rs`**
- Register updater plugin in builder

## Key Files to Modify
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/src/lib.rs`
- `.github/workflows/release.yml`
- `package.json`
- `src/App.tsx` or new `src/components/UpdateChecker.tsx`

## Verification
1. Build app locally with updater enabled
2. Create test release with higher version
3. Run older version → should prompt for update
4. Click update → verify download and install works
5. Test on all platforms (Windows, macOS, Linux AppImage)

## Notes
- Flathub builds unaffected (separate distribution)
- AppImage requires FUSE for self-updates on Linux
- macOS not notarized currently (users must right-click → Open on first run)

## Decisions
- Update check: **on app launch only**
- UX: **prompt user** (not silent/automatic)
- Hosting: **GitHub Releases**
