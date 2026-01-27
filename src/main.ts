import {invoke} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";

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

interface CredentialsConfig {
    access_key_id: string;
    secret_access_key: string | null;
}

interface Config {
    storage: StorageConfig;
    credentials: CredentialsConfig
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

async function uploadFile(localPath: string, key: string): Promise<void> {
    try {
        await invoke("upload_file", {key, path: localPath});
        console.log("Uploaded:", key);
    } catch (e) {
        console.error("Upload failed:", e);
    }
}

async function init() {
    setupEventListeners();
    setupDropZone();
    setUpSettingsButton();
    setUpConnScreen();

    const isConfigured = await invoke<boolean>("check_config");
    if (isConfigured) {
        showScreen("browser");
        await loadFiles("");
    } else {
        showScreen("setup");
    }
}

async function handleConnection() {
    const endpoint = (document.getElementById("endpoint") as HTMLInputElement).value;
    const bucket = (document.getElementById("bucket") as HTMLInputElement).value;
    const region = (document.getElementById("region") as HTMLInputElement).value;
    const accessKey = (document.getElementById("access-key") as HTMLInputElement).value;
    const secretKey = (document.getElementById("secret-key") as HTMLInputElement).value;

    const errorEl = document.getElementById("setup-error")!;
    const btn = document.getElementById("btn-connect") as HTMLButtonElement;

    try {
        btn.disabled = true;
        btn.textContent = "Connecting...";
        errorEl.classList.add("hidden");

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

function createFileItem(file: File): HTMLElement {
    const item = document.createElement("div");
    item.className = "file-item";

    item.innerHTML = `
    <span class="icon">${file.isFolder ? "📁" : "📄"}</span>
    <span class="name">${file.name}</span>
    <span class="size">${file.isFolder ? "" : formatSize(file.size)}</span>
  `;

    item.addEventListener("click", () => handleFileClick(file));
    return item;
}

function handleFileClick(file: File): void {
    if (file.isFolder) {
        loadFiles(file.key);
    } else {
        console.log("Download:", file.key);
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
            (document.getElementById("access-key") as HTMLInputElement).value = config.credentials.access_key_id;
            (document.getElementById("secret-key") as HTMLInputElement).value = config.credentials.secret_access_key || "";
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
        const key = currentPath + filename;
        await uploadFile(path, key);
    }
    loadFiles(currentPath);
}

function setupEventListeners(): void {
    document.getElementById("btn-back")?.addEventListener("click", navigateUp);
    document.getElementById("btn-refresh")?.addEventListener("click", () => loadFiles(currentPath));
    document.getElementById("btn-new-folder")?.addEventListener("click", () => {
        console.log("New folder clicked");
    });
}

window.addEventListener("DOMContentLoaded", () => {
    init()
});

listen<DropPayload>("tauri://drag-drop", (event) => {
    handleFileDrop(event.payload.paths);
});