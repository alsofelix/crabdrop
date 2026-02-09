import {invoke} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";

interface UploadState {
    id: string;
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

const uploadStates = new Map<string, UploadState>();

function generateUploadId(): string {
    return crypto.randomUUID();
}

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
    encrypted: boolean;
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
    has_encryption_passphrase: boolean,
}

interface DropPayload {
    paths: string[];
    position: { x: number; y: number };
}

let currentPath = "";
let pendingDropPaths: string[] = [];

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

async function uploadPath(localPath: string, targetPrefix: string, uploadId: string, encrypted: boolean): Promise<void> {
    try {
        await invoke("upload_path", {localPath, targetPrefix, uploadId, encrypted});
        console.log("Uploaded:", targetPrefix);
    } catch (e) {
        console.error("Upload failed:", e);
        uploadStates.delete(uploadId);
        renderUploadOverlay();
    }
}

async function init() {
    setupEventListeners();
    setupDragOverlay();
    setupEncryptConfirmModal();
    setUpSettingsButton();
    setUpConnScreen();
    setupFolderModal();
    setupUploadEvents();
    setupDownloadEvents();
    setupContextMenu();
    setupShareModal();

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
        await invoke("download_file", {key: file.key, filename: file.name, encrypted: file.encrypted});
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
    let encryptionPassphrase: string | undefined = (document.getElementById("encryption-passphrase") as HTMLInputElement).value;

    const errorEl = document.getElementById("setup-error")!;
    const btn = document.getElementById("btn-connect") as HTMLButtonElement;

    try {
        btn.disabled = true;
        btn.textContent = "Connecting...";
        errorEl.classList.add("hidden");

        if (secretKey.trim() == "") {
            secretKey = undefined;
        }

        if (encryptionPassphrase.trim() === "") {
            encryptionPassphrase = undefined;
        }

        await invoke("save_config", {endpoint, bucket, region, accessKey, secretKey, encryptionPassphrase});
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

function renderUploadOverlay() {
    const panel = document.getElementById("upload-panel")!;
    const list = document.getElementById("upload-list")!;
    const title = document.getElementById("upload-panel-title")!;

    if (uploadStates.size === 0) {
        panel.classList.add("hidden");
        return;
    }

    panel.classList.remove("hidden");
    title.textContent = uploadStates.size === 1 ? "Uploading" : `Uploading (${uploadStates.size})`;
    list.innerHTML = "";

    for (const [id, state] of uploadStates) {
        const item = createUploadItem(id, state);
        list.appendChild(item);
    }
}

function createUploadItem(id: string, state: UploadState): HTMLElement {
    const template = document.getElementById("upload-item-template") as HTMLTemplateElement;
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const root = fragment.querySelector(".upload-item") as HTMLElement;

    root.dataset.uploadId = id;

    const fill = root.querySelector(".upload-progress-fill") as HTMLElement;
    if (state.percent < 0) {
        fill.classList.add("indeterminate");
    } else {
        fill.style.width = `${state.percent}%`;
    }

    root.querySelector(".upload-icon")!.textContent = state.isFolder ? "📁" : "📄";
    root.querySelector(".upload-name")!.textContent = state.filename;
    root.querySelector(".upload-percent")!.textContent = state.percent < 0 ? "" : `${state.percent}%`;

    const details = root.querySelector(".upload-details")!;
    if (state.isMultipart && state.totalParts > 0) {
        const partInfo = document.createElement("span");
        partInfo.className = "upload-part-info";
        partInfo.textContent = `Part ${state.part}/${state.totalParts}`;
        details.appendChild(partInfo);
    }
    if (state.isFolder && state.totalFiles > 0) {
        const fileInfo = document.createElement("span");
        fileInfo.className = "upload-file-info";
        fileInfo.textContent = `${state.currentFile}/${state.totalFiles} files`;
        details.appendChild(fileInfo);
    }

    root.querySelector(".upload-item-close")!.addEventListener("click", () => {
        uploadStates.delete(id);
        renderUploadOverlay();
    });

    return root;
}

function showDownloadOverlay() {
    document.getElementById("download-overlay")!.classList.remove("hidden");
}

function hideDownloadOverlay() {
    document.getElementById("download-overlay")!.classList.add("hidden");
}

function getOrCreateUploadState(uploadId: string): UploadState {
    let state = uploadStates.get(uploadId);
    if (!state) {
        state = {
            id: uploadId,
            active: true,
            filename: "",
            isMultipart: false,
            percent: -1,
            part: 0,
            totalParts: 0,
            isFolder: false,
            currentFile: 0,
            totalFiles: 0,
        };
        uploadStates.set(uploadId, state);
    }
    return state;
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
    document.getElementById("upload-panel-close")?.addEventListener("click", () => {
        uploadStates.clear();
        renderUploadOverlay();
    });

    listen("upload_start", (event: any) => {
        const data = event.payload;
        const uploadId = data.uploadId;
        if (!uploadId) return;

        const state = getOrCreateUploadState(uploadId);
        state.filename = data.filename;
        state.isMultipart = data.multipart || false;
        state.percent = data.multipart ? 0 : -1;
        state.part = 0;
        state.totalParts = data.totalParts || 0;
        state.isFolder = data.isFolder || false;
        state.currentFile = data.currentFile || 0;
        state.totalFiles = data.totalFiles || 0;

        renderUploadOverlay();
    });

    listen("upload_progress", (event: any) => {
        const data = event.payload;
        const uploadId = data.uploadId;
        if (!uploadId) return;

        const state = uploadStates.get(uploadId);
        if (!state) return;

        state.part = data.part;
        state.totalParts = data.totalParts;
        state.percent = Math.round((data.part / data.totalParts) * 100);
        if (data.filename) state.filename = data.filename;

        renderUploadOverlay();
    });

    listen("folder_progress", (event: any) => {
        const data = event.payload;
        const uploadId = data.uploadId;
        if (!uploadId) return;

        const state = uploadStates.get(uploadId);
        if (!state) return;

        state.currentFile = data.currentFile;
        state.totalFiles = data.totalFiles;
        if (data.filename) state.filename = data.filename;
        state.isFolder = true;

        renderUploadOverlay();
    });

    listen("upload_complete", (event: any) => {
        const data = event.payload || {};
        const uploadId = data.uploadId;
        if (!uploadId) return;

        const state = uploadStates.get(uploadId);
        if (!state) return;

        state.percent = 100;
        renderUploadOverlay();

        setTimeout(() => {
            uploadStates.delete(uploadId);
            renderUploadOverlay();
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
    const shareBtn = document.getElementById("ctx-share")!;

    downloadBtn.classList.toggle("hidden", file.isFolder);
    shareBtn.classList.toggle("hidden", file.isFolder);

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

    document.getElementById("ctx-share")?.addEventListener("click", () => {
        if (selectedFile && !selectedFile.isFolder) {
            showShareModal(selectedFile);
        }
        hideContextMenu();
    });
}

function createFileItem(file: File): HTMLElement {
    const item = document.createElement("div");
    item.className = "file-item";

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = file.isFolder ? "📁" : "📄";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = file.name;

    const size = document.createElement("span");
    size.className = "size";
    size.textContent = file.isFolder ? "" : formatSize(file.size);

    item.appendChild(icon);
    item.appendChild(name);

    if (file.encrypted) {
        const lockIcon = document.createElement("span");
        lockIcon.className = "lock-icon";
        lockIcon.textContent = "\uD83D\uDD12";
        item.appendChild(lockIcon);
    }

    item.appendChild(size);

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

            const encPassEl = document.getElementById("encryption-passphrase") as HTMLInputElement;
            encPassEl.value = "";
            if (config.has_encryption_passphrase) {
                encPassEl.placeholder = "Saved (leave blank to keep)";
                encPassEl.required = false;
            } else {
                encPassEl.placeholder = "Encryption passphrase (optional)";
                encPassEl.required = false;
            }

            showScreen("setup");
        } catch (err) {
            console.error(err);
        }
    })
}

function setupDragOverlay(): void {
    const overlay = document.getElementById("drag-overlay")!;

    listen("tauri://drag-over", () => {
        overlay.classList.remove("hidden");
    });

    listen("tauri://drag-leave", () => {
        overlay.classList.add("hidden");
    });

    listen("tauri://drag-drop", () => {
        overlay.classList.add("hidden");
    });
}

function setupEncryptConfirmModal(): void {
    const modal = document.getElementById("encrypt-confirm-modal")!;
    const cancelBtn = document.getElementById("encrypt-confirm-cancel")!;
    const uploadBtn = document.getElementById("encrypt-confirm-upload")!;
    const toggle = document.getElementById("encrypt-toggle") as HTMLInputElement;

    uploadBtn.addEventListener("click", () => {
        modal.classList.add("hidden");
        startUpload(toggle.checked);
        toggle.checked = false;
    });

    cancelBtn.addEventListener("click", () => {
        modal.classList.add("hidden");
        pendingDropPaths = [];
        toggle.checked = false;
    });

    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.add("hidden");
            pendingDropPaths = [];
            toggle.checked = false;
        }
    });
}

async function startUpload(encrypted: boolean): Promise<void> {
    const paths = pendingDropPaths;
    pendingDropPaths = [];

    const uploadPromises = paths.map((path) => {
        const filename = getFilenameFromPath(path);
        const targetPrefix = currentPath + filename;
        const uploadId = generateUploadId();
        return uploadPath(path, targetPrefix, uploadId, encrypted);
    });

    await Promise.all(uploadPromises);
    await loadFiles(currentPath);
}

function handleFileDrop(paths: string[]): void {
    pendingDropPaths.push(...paths);
    const modal = document.getElementById("encrypt-confirm-modal")!;
    const countEl = document.getElementById("encrypt-confirm-count")!;
    const fileListEl = document.getElementById("encrypt-confirm-files")!;

    countEl.textContent = pendingDropPaths.length === 1
        ? `1 file ready to upload`
        : `${pendingDropPaths.length} files ready to upload`;

    fileListEl.innerHTML = "";
    for (const path of pendingDropPaths) {
        const item = document.createElement("div");
        item.className = "encrypt-file-item";
        item.textContent = getFilenameFromPath(path);
        fileListEl.appendChild(item);
    }

    modal.classList.remove("hidden");
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

function showShareModal(file: File): void {
    const modal = document.getElementById("share-modal")!;
    const filenameEl = document.getElementById("share-filename")!;
    const urlContainer = document.getElementById("share-url-container")!;
    const urlInput = document.getElementById("share-url") as HTMLInputElement;
    const errorEl = document.getElementById("share-error")!;
    const generateBtn = document.getElementById("share-generate") as HTMLButtonElement;

    filenameEl.textContent = file.name;
    urlContainer.classList.add("hidden");
    urlInput.value = "";
    errorEl.classList.add("hidden");
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate Link";

    const existingNotice = modal.querySelector(".share-encrypted-notice");
    if (existingNotice) existingNotice.remove();

    if (file.encrypted) {
        const notice = document.createElement("div");
        notice.className = "share-encrypted-notice";
        notice.textContent = "This file is encrypted. The share link will include the decryption key.";
        urlContainer.parentElement!.insertBefore(notice, urlContainer);
    }

    modal.dataset.fileKey = file.key;
    modal.dataset.fileEncrypted = String(file.encrypted);
    modal.classList.remove("hidden");
}

function hideShareModal(): void {
    document.getElementById("share-modal")!.classList.add("hidden");
}

function setupShareModal(): void {
    const modal = document.getElementById("share-modal")!;
    const cancelBtn = document.getElementById("share-cancel")!;
    const generateBtn = document.getElementById("share-generate")!;
    const copyBtn = document.getElementById("share-copy")!;
    const urlInput = document.getElementById("share-url") as HTMLInputElement;

    cancelBtn.addEventListener("click", hideShareModal);

    modal.addEventListener("click", (e) => {
        if (e.target === modal) hideShareModal();
    });

    generateBtn.addEventListener("click", async () => {
        const fileKey = modal.dataset.fileKey;
        if (!fileKey) return;

        const expirySelect = document.getElementById("share-expiry") as HTMLSelectElement;
        const expirySecs = parseInt(expirySelect.value, 10);
        const urlContainer = document.getElementById("share-url-container")!;
        const errorEl = document.getElementById("share-error")!;
        const btn = generateBtn as HTMLButtonElement;

        try {
            btn.disabled = true;
            btn.textContent = "Generating...";
            errorEl.classList.add("hidden");

            let url = await invoke<string>("generate_presigned_url", {
                key: fileKey,
                expirySecs,
            });

            if (modal.dataset.fileEncrypted === "true") {
                const derivedKey = await invoke<string>("get_file_key", {key: fileKey});
                url += "#key=" + derivedKey;
            }

            urlInput.value = url;
            urlContainer.classList.remove("hidden");
            btn.textContent = "Regenerate";
        } catch (err) {
            errorEl.textContent = String(err);
            errorEl.classList.remove("hidden");
            btn.textContent = "Generate Link";
        } finally {
            btn.disabled = false;
        }
    });

    copyBtn.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(urlInput.value);
            copyBtn.textContent = "Copied!";
            copyBtn.classList.add("copied");
            setTimeout(() => {
                copyBtn.textContent = "Copy";
                copyBtn.classList.remove("copied");
            }, 2000);
        } catch {
            urlInput.select();
            document.execCommand("copy");
        }
    });
}

window.addEventListener("DOMContentLoaded", () => {
    init()
});

listen<DropPayload>("tauri://drag-drop", (event) => {
    handleFileDrop(event.payload.paths);
});
