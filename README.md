# 🦀 crabdrop

A simple, fast file manager for S3-compatible storage.

![crabdrop screenshot](screenshots/main-app-screenshot.png)

## Features

- Browse, upload, and download files
- Drag and drop uploads
- Multipart upload for large files (100MB+)
- Folder upload support
- Upload progress tracking
- Works with AWS S3, Cloudflare R2, MinIO, and any S3-compatible service

## Installation

### macOS / Windows / Linux

Download the latest release from [GitHub Releases](https://github.com/alsofelix/crabdrop/releases).

| Platform              | Download              |
|-----------------------|-----------------------|
| macOS (Apple Silicon) | `.dmg`                |
| macOS (Intel)         | `.dmg`                |
| Windows               | `.msi` or `.exe`      |
| Linux                 | `.deb` or `.AppImage` |

### Flathub

Run `flatpak install flathub io.github.alsofelix.crabdrop`

## Building from source

Requires [Rust](https://rust-lang.org/tools/install/) and [Bun](https://bun.sh/).

```bash
git clone https://github.com/alsofelix/crabdrop.git
cd crabdrop
bun install
bun tauri build
```

## License

MIT
