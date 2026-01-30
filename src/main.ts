import {invoke} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";

interface UploadState {
    active: boolean;
    filename: string;
    isMultipart: boolean;
    percent: number;
    part: number;
    totalParts: number;
    isFolder: boolean;
    currentFile: number;
    totalFiles: number;
}

let uploadState: UploadState = {
    active: false,
    filename: "",
    isMultipart: false,
    percent: -1,
    part: 0,
    totalParts: 0,
    isFolder: false,
    currentFile: 0,
    totalFiles: 0,
};

interface DownloadState {
    active: boolean;
    filename: string;
    percent: number;
    downloadedBytes: number;
    totalBytes: number;
}

let downloadState: DownloadState = {
    active: false,
    filename: "",
    percent: -1,
    downloadedBytes: 0,
    totalBytes: 0,
};
let selectedFile: File | null = null;

interface File {
    name: string;
    key: string;
    size: number | null;
    isFolder: boolean;
    lastModified: number | null;
}

interface StorageConfig {
    endpoint: string;
    bucket: string;
    region: string
}

interface Config {
    storage: StorageConfig;
    access_key_id: string,
    has_secret: boolean,
}

interface DropPayload {
    paths: string[];
    position: { x: number; y: number };
}

let currentPath = "";

async function loadFiles(prefix: string): Promise<void> {
    try {
        const files = await invoke<File[]>("list_files", {prefix});
        currentPath = prefix;
        updateBreadcrumb(prefix);
        renderFiles(files);
    } catch (e) {
        console.error("Failed to load files:", e);
    }
}

async function uploadPath(localPath: string, targetPrefix: string): Promise<void> {
    try {
        await invoke("upload_path", {localPath, targetPrefix});
        console.log("Uploaded:", targetPrefix);
    } catch (e) {
        console.error("Upload failed:", e);
    }
}

async function init() {
    setupEventListeners();
    setupDropZone();
    setUpSettingsButton();
    setUpConnScreen();
    setupFolderModal();
    setupUploadEvents();
    setupDownloadEvents();
    setupContextMenu();

    const isConfigured = await invoke<boolean>("check_config");
    if (isConfigured) {
        showScreen("browser");
        await loadFiles("");
    } else {
        showScreen("setup");
    }
}

async function downloadFile(file: File): Promise<void> {
    try {
        await invoke("download_file", {key: file.key, filename: file.name});
    } catch (e) {
        console.error("Download failed:", e);
    }
}

async function deleteFile(file: File): Promise<void> {
    try {
        await invoke("delete_file", {key: file.key, isFolder: file.isFolder});
        await loadFiles(currentPath);
    } catch (e) {
        console.error("Delete failed:", e);
    }
}

async function handleConnection() {
    const endpoint = (document.getElementById("endpoint") as HTMLInputElement).value;
    const bucket = (document.getElementById("bucket") as HTMLInputElement).value;
    const region = (document.getElementById("region") as HTMLInputElement).value;
    const accessKey = (document.getElementById("access-key") as HTMLInputElement).value;
    let secretKey: string | undefined = (document.getElementById("secret-key") as HTMLInputElement).value;

    const errorEl = document.getElementById("setup-error")!;
    const btn = document.getElementById("btn-connect") as HTMLButtonElement;

    try {
        btn.disabled = true;
        btn.textContent = "Connecting...";
        errorEl.classList.add("hidden");

        if (secretKey.trim() == "") {
            secretKey = undefined;
        }

        await invoke("save_config", {endpoint, bucket, region, accessKey, secretKey});
        await invoke("test_connection");

        showScreen("browser");
        await loadFiles("");
    } catch (err) {
        errorEl.textContent = String(err);
        errorEl.classList.remove("hidden");
    } finally {
        btn.disabled = false;
        btn.textContent = "Connect";
    }
}

function setUpConnScreen() {
    document.getElementById("setup-form")?.addEventListener("submit", async (e) => {
        e.preventDefault()
        await handleConnection()
    })
}

function showScreen(screen: "setup" | "browser") {
    document.getElementById("setup-screen")!.classList.toggle("hidden", screen !== "setup");
    document.getElementById("browser-screen")!.classList.toggle("hidden", screen !== "browser");
}

function showUploadOverlay() {
    document.getElementById("upload-overlay")!.classList.remove("hidden");
}

function hideUploadOverlay() {
    document.getElementById("upload-overlay")!.classList.add("hidden");
}

function showDownloadOverlay() {
    document.getElementById("download-overlay")!.classList.remove("hidden");
}

function hideDownloadOverlay() {
    document.getElementById("download-overlay")!.classList.add("hidden");
}

function updateUploadUI() {
    const nameEl = document.getElementById("upload-name")!;
    const fillEl = document.getElementById("upload-progress-fill")!;
    const percentEl = document.getElementById("upload-percent")!;
    const partEl = document.getElementById("upload-part-info")!;
    const fileEl = document.getElementById("upload-file-info")!;

    nameEl.textContent = uploadState.filename;

    if (uploadState.percent < 0) {
        fillEl.classList.add("indeterminate");
        fillEl.style.width = "";
        percentEl.textContent = "";
    } else {
        fillEl.classList.remove("indeterminate");
        fillEl.style.width = uploadState.percent + "%";
        percentEl.textContent = uploadState.percent + "%";
    }

    if (uploadState.isMultipart && uploadState.totalParts > 0) {
        partEl.textContent = `Part ${uploadState.part}/${uploadState.totalParts} • Multipart`;
        partEl.classList.remove("hidden");
    } else {
        partEl.classList.add("hidden");
    }

    if (uploadState.isFolder && uploadState.totalFiles > 0) {
        fileEl.textContent = `File ${uploadState.currentFile} of ${uploadState.totalFiles}`;
        fileEl.classList.remove("hidden");
    } else {
        fileEl.classList.add("hidden");
    }
}

function updateDownloadUI() {
    const nameEl = document.getElementById("download-name")!;
    const fillEl = document.getElementById("download-progress-fill")!;
    const percentEl = document.getElementById("download-percent")!;
    const sizeEl = document.getElementById("download-size-info")!;

    nameEl.textContent = downloadState.filename;

    if (downloadState.percent < 0) {
        fillEl.classList.add("indeterminate");
        fillEl.style.width = "";
        percentEl.textContent = "";
    } else {
        fillEl.classList.remove("indeterminate");
        fillEl.style.width = downloadState.percent + "%";
        percentEl.textContent = downloadState.percent + "%";
    }

    if (downloadState.totalBytes > 0 || downloadState.downloadedBytes > 0) {
        if (downloadState.totalBytes > 0) {
            const downloaded = formatSize(downloadState.downloadedBytes);
            const total = formatSize(downloadState.totalBytes);
            sizeEl.textContent = `${downloaded} of ${total}`;
        } else {
            sizeEl.textContent = `${formatSize(downloadState.downloadedBytes)} downloaded`;
        }
        sizeEl.classList.remove("hidden");
    } else {
        sizeEl.classList.add("hidden");
    }
}

function setupUploadEvents() {
    document.getElementById("upload-close")?.addEventListener("click", () => {
        hideUploadOverlay();
    });

    listen("upload_start", (event: any) => {
        const data = event.payload;
        uploadState = {
            active: true,
            filename: data.filename,
            isMultipart: data.multipart || false,
            percent: data.multipart ? 0 : -1,
            part: 0,
            totalParts: data.totalParts || 0,
            isFolder: data.isFolder || false,
            currentFile: data.currentFile || 0,
            totalFiles: data.totalFiles || 0,
        };
        showUploadOverlay();
        updateUploadUI();
    });

    listen("upload_progress", (event: any) => {
        const data = event.payload;
        uploadState.part = data.part;
        uploadState.totalParts = data.totalParts;
        uploadState.percent = Math.round((data.part / data.totalParts) * 100);
        if (data.filename) uploadState.filename = data.filename;
        updateUploadUI();
    });

    listen("folder_progress", (event: any) => {
        const data = event.payload;
        uploadState.currentFile = data.currentFile;
        uploadState.totalFiles = data.totalFiles;
        if (data.filename) uploadState.filename = data.filename;
        uploadState.isFolder = true;
        updateUploadUI();
    });

    listen("upload_complete", (_event: any) => {
        uploadState.percent = 100;
        updateUploadUI();
        setTimeout(() => {
            hideUploadOverlay();
            uploadState.active = false;
        }, 1000);
    });
}

function setupDownloadEvents() {
    document.getElementById("download-close")?.addEventListener("click", () => {
        hideDownloadOverlay();
        downloadState.active = false;
    });

    listen("download_start", (event: any) => {
        const data = event.payload || {};
        const total = typeof data.totalBytes === "number"
            ? data.totalBytes
            : typeof data.size === "number"
                ? data.size
                : 0;
        downloadState = {
            active: true,
            filename: data.filename || data.name || "Download",
            percent: total > 0 ? 0 : -1,
            downloadedBytes: 0,
            totalBytes: total,
        };
        showDownloadOverlay();
        updateDownloadUI();
    });

    listen("download_progress", (event: any) => {
        const data = event.payload || {};
        if (typeof data.totalBytes === "number") {
            downloadState.totalBytes = data.totalBytes;
        }
        if (typeof data.downloadedBytes === "number") {
            downloadState.downloadedBytes = data.downloadedBytes;
        } else if (typeof data.bytesDownloaded === "number") {
            downloadState.downloadedBytes = data.bytesDownloaded;
        }
        if (downloadState.totalBytes > 0) {
            downloadState.percent = Math.min(
                100,
                Math.round((downloadState.downloadedBytes / downloadState.totalBytes) * 100),
            );
        } else if (typeof data.percent === "number") {
            downloadState.percent = Math.round(data.percent);
        } else {
            downloadState.percent = -1;
        }
        if (data.filename) {
            downloadState.filename = data.filename;
        }
        updateDownloadUI();
    });

    listen("download_complete", (event: any) => {
        const data = event.payload || {};
        if (typeof data.totalBytes === "number") {
            downloadState.totalBytes = data.totalBytes;
        }
        if (data.filename) {
            downloadState.filename = data.filename;
        }
        if (downloadState.totalBytes > 0) {
            downloadState.downloadedBytes = downloadState.totalBytes;
        }
        downloadState.percent = 100;
        updateDownloadUI();
        setTimeout(() => {
            hideDownloadOverlay();
            downloadState.active = false;
            downloadState.percent = -1;
        }, 1000);
    });
}

function updateBreadcrumb(path: string): void {
    const el = document.getElementById("current-path")!;
    el.textContent = "/" + path || "/";
}

function renderFiles(files: File[]): void {
    const list = document.getElementById("file-list")!;
    list.innerHTML = "";

    for (const file of files) {
        const item = createFileItem(file);
        list.appendChild(item);
    }
}

function showContextMenu(e: MouseEvent, file: File): void {
    e.preventDefault();
    selectedFile = file;

    const menu = document.getElementById("context-menu")!;
    const downloadBtn = document.getElementById("ctx-download")!;

    downloadBtn.classList.toggle("hidden", file.isFolder);

    menu.style.left = e.clientX + "px";
    menu.style.top = e.clientY + "px";
    menu.classList.remove("hidden");
}

function hideContextMenu(): void {
    document.getElementById("context-menu")!.classList.add("hidden");
    selectedFile = null;
}

function setupContextMenu(): void {
    document.addEventListener("click", hideContextMenu);
    document.addEventListener("contextmenu", (e) => {
        if (!(e.target as HTMLElement).closest(".file-item")) {
            hideContextMenu();
        }
    });

    document.getElementById("ctx-download")?.addEventListener("click", () => {
        if (selectedFile && !selectedFile.isFolder) {
            downloadFile(selectedFile);
        }
        hideContextMenu();
    });

    document.getElementById("ctx-delete")?.addEventListener("click", () => {
        if (selectedFile) {
            deleteFile(selectedFile);
        }
        hideContextMenu();
    });
}

function createFileItem(file: File): HTMLElement {
    const item = document.createElement("div");
    item.className = "file-item";

    item.innerHTML = `
    <span class="icon">${file.isFolder ? "📁" : "📄"}</span>
    <span class="name">${file.name}</span>
    <span class="size">${file.isFolder ? "" : formatSize(file.size)}</span>
  `;

    item.addEventListener("click", () => handleFileClick(file));
    item.addEventListener("contextmenu", (e) => showContextMenu(e, file));
    return item;
}


function handleFileClick(file: File): void {
    if (file.isFolder) {
        loadFiles(file.key);
    } else {
        downloadFile(file)
    }
}

function formatSize(bytes: number | null): string {
    if (bytes === null) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function getFilenameFromPath(path: string): string {
    return path.split("/").pop() || path.split("\\").pop() || "file";
}

function navigateUp(): void {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    const newPath = parts.length ? parts.join("/") + "/" : "";
    loadFiles(newPath);
}

function setUpSettingsButton() {
    document.getElementById("btn-settings")?.addEventListener("click", async () => {
        try {
            const config: Config = await invoke<Config>("get_config");

            (document.getElementById("endpoint") as HTMLInputElement).value = config.storage.endpoint;
            (document.getElementById("bucket") as HTMLInputElement).value = config.storage.bucket;
            (document.getElementById("region") as HTMLInputElement).value = config.storage.region;
            (document.getElementById("access-key") as HTMLInputElement).value = config.access_key_id;

            const secretEl = document.getElementById("secret-key") as HTMLInputElement;
            secretEl.required = !config.has_secret;

            secretEl.value = "";
            secretEl.placeholder = config.has_secret
                ? "Saved in Keychain (leave blank to keep)"
                : "Enter secret key";

            showScreen("setup");
        } catch (err) {
            console.error(err);
        }
    })
}

function setupDropZone(): void {
    const dropZone = document.getElementById("drop-zone")!;

    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("drag-over");
    });

    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
    });
}

async function handleFileDrop(paths: string[]): Promise<void> {
    for (const path of paths) {
        const filename = getFilenameFromPath(path);
        const targetPrefix = currentPath + filename;
        await uploadPath(path, targetPrefix);
    }
    await loadFiles(currentPath);
}

function setupFolderModal() {
    const modal = document.getElementById("folder-modal")!;
    const input = document.getElementById("folder-name") as HTMLInputElement;
    const btnCreate = document.getElementById("folder-create")!;
    const btnCancel = document.getElementById("folder-cancel")!;

    document.getElementById("btn-new-folder")?.addEventListener("click", () => {
        input.value = "";
        modal.classList.remove("hidden");
        input.focus();
    });

    btnCancel.addEventListener("click", () => {
        modal.classList.add("hidden");
    });

    btnCreate.addEventListener("click", async () => {
        const name = input.value.trim();
        if (!name) return;

        const key = currentPath + name + "/";
        try {
            await invoke("upload_folder", {key});
            modal.classList.add("hidden");
            await loadFiles(currentPath);
        } catch (e) {
            console.error("Failed to create folder:", e);
        }
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") btnCreate.click();
        if (e.key === "Escape") btnCancel.click();
    });

    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.add("hidden");
    });
}

function setupEventListeners(): void {
    document.getElementById("btn-back")?.addEventListener("click", navigateUp);
    document.getElementById("btn-refresh")?.addEventListener("click", () => loadFiles(currentPath));
}

window.addEventListener("DOMContentLoaded", () => {
    init()
});

listen<DropPayload>("tauri://drag-drop", (event) => {
    handleFileDrop(event.payload.paths);
});
