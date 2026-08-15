import {invoke} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";
import {setupModalKeyboardControls} from "./modal_keyboard";
import {
    type AppScreen,
    type CredentialFieldState,
    type CredentialRemovalKind,
    type StatusMessageType,
    determineStartupDestination,
    formatBucketPath,
    getBatchDownloadProgress,
    getCachedFilesAfterScreenChange,
    getCredentialRemovalPrompt,
    getDeletePrompt,
    getDownloadAllCompletionAlert,
    getDownloadAllPrompt,
    getPassphraseFieldState,
    getSecretKeyFieldState,
    getEndpointWarning,
    getLikelyEncryptedDownloadPrompt,
    getSearchQueryAfterScreenChange,
    getStatusMessageContainerId,
    getStatusMessagePresentation,
    getUniqueErrorMessages,
    hideCompletedDownloadAfterDelay,
    isTextOverflowing,
    matchesBrowserSearch,
    requiresEncryptedCopyConfirmation,
    runDownloadWithFailureCleanup,
    runRefreshWithFeedback,
    selectDownloadAllFiles,
} from "./ui_logic";

function showStatusMessage(message: string, type: StatusMessageType = "error", durationMs = 3000): void {
    const screen: AppScreen = document
        .getElementById("browser-screen")!
        .classList
        .contains("hidden")
        ? "setup"
        : "browser";
    const container = document.getElementById(getStatusMessageContainerId(screen))!;
    const presentation = getStatusMessagePresentation(type);
    const el = document.createElement("div");
    el.className = presentation.className;
    el.setAttribute("role", presentation.role);
    el.textContent = message;
    container.appendChild(el);

    setTimeout(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            el.remove();
            return;
        }

        el.classList.add("status-message-out");
        const removalFallback = setTimeout(() => el.remove(), 250);
        el.addEventListener("animationend", () => {
            clearTimeout(removalFallback);
            el.remove();
        }, {once: true});
    }, durationMs);
}

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
let selectedFileIndex: number | null = null;
let displayedFiles: File[] = [];

interface File {
    name: string;
    key: string;
    size: number | null;
    isFolder: boolean;
    lastModified: number | null;
    encrypted: boolean;
    likelyEncrypted: boolean;
    isMetadata: boolean;
}

interface BatchDownloadState {
    processed: number;
    total: number;
    overlayDismissed: boolean;
}

let pendingEncryptedCopyDownload: File | null = null;
let pendingDownloadAllFiles: File[] = [];
let batchDownloadState: BatchDownloadState | null = null;
let downloadCompletionTimer: ReturnType<typeof setTimeout> | null = null;
const downloadIdleResolvers = new Set<() => void>();

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
let currentBucket = "";
let currentFiles: File[] = [];
let pendingDropPaths: string[] = [];

interface FilterState {
    type: "all" | "folders" | "files";
    encryption: "all" | "encrypted" | "unencrypted";
    size: "all" | "small" | "medium" | "large";
}

const activeFilters: FilterState = {
    type: "all",
    encryption: "all",
    size: "all",
};

type SortKey = "name-asc" | "name-desc" | "size-asc" | "size-desc" | "date-desc" | "date-asc";
let activeSort: SortKey = "name-asc";

function applyFilters(): void {
    const query = (document.getElementById("search-input") as HTMLInputElement).value;

    const searchMatches = currentFiles.filter(file => matchesBrowserSearch(file, query));
    const metadataFiles = searchMatches.filter(file => file.isMetadata);
    let filtered = searchMatches.filter(file => !file.isMetadata);

    if (activeFilters.type === "folders") {
        filtered = filtered.filter(f => f.isFolder);
    } else if (activeFilters.type === "files") {
        filtered = filtered.filter(f => !f.isFolder);
    }

    if (activeFilters.encryption === "encrypted") {
        filtered = filtered.filter(f => f.encrypted || f.likelyEncrypted);
    } else if (activeFilters.encryption === "unencrypted") {
        filtered = filtered.filter(f => !f.encrypted && !f.likelyEncrypted);
    }

    if (activeFilters.size !== "all") {
        filtered = filtered.filter(f => {
            if (f.isFolder || f.size === null) return false;
            const mb = f.size / (1024 * 1024);
            if (activeFilters.size === "small") return mb < 1;
            if (activeFilters.size === "medium") return mb >= 1 && mb <= 100;
            return mb > 100;
        });
    }

    // Folders first, then sort within each group
    const folders = filtered.filter(f => f.isFolder);
    const files = filtered.filter(f => !f.isFolder);

    const sortFn = (a: File, b: File): number => {
        switch (activeSort) {
            case "name-asc":
                return a.name.localeCompare(b.name);
            case "name-desc":
                return b.name.localeCompare(a.name);
            case "size-asc":
                return (a.size ?? 0) - (b.size ?? 0);
            case "size-desc":
                return (b.size ?? 0) - (a.size ?? 0);
            case "date-desc":
                return (b.lastModified ?? 0) - (a.lastModified ?? 0);
            case "date-asc":
                return (a.lastModified ?? 0) - (b.lastModified ?? 0);
            default:
                return 0;
        }
    };

    folders.sort(sortFn);
    files.sort(sortFn);

    renderFiles([...metadataFiles, ...folders, ...files]);
}

async function loadFiles(prefix: string): Promise<boolean> {
    try {
        const files = await invoke<File[]>("list_files", {prefix});
        const isNewPath = prefix !== currentPath;
        currentPath = prefix;
        currentFiles = files;
        updateBreadcrumb(prefix);

        if (isNewPath) {
            (document.getElementById("search-input") as HTMLInputElement).value = "";

            activeFilters.type = "all";
            activeFilters.encryption = "all";
            activeFilters.size = "all";
            (document.getElementById("filter-type") as HTMLSelectElement).value = "all";
            (document.getElementById("filter-encryption") as HTMLSelectElement).value = "all";
            (document.getElementById("filter-size") as HTMLSelectElement).value = "all";

            activeSort = "name-asc";
            (document.getElementById("sort-select") as HTMLSelectElement).value = "name-asc";
        }

        applyFilters();
        return true;
    } catch (e) {
        console.error("Failed to load files:", e);
        showStatusMessage(String(e), "error", 8000);
        return false;
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
        throw e;
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
    setupCredentialRemovalModal();
    setupEncryptedCopyDownloadModal();
    setupDownloadAllModal();
    setupModalKeyboardControls();
    setupKeyboardShortcuts();

    const isConfigured = await invoke<boolean>("check_config");
    if (isConfigured) {
        const config = await invoke<Config>("get_config");
        currentBucket = config.storage.bucket;
    }

    const destination = await determineStartupDestination(
        isConfigured,
        () => invoke<void>("test_connection"),
        () => loadFiles(""),
    );

    if (destination.screen === "browser") {
        showScreen("browser");
    } else {
        await loadConfig(destination.error);
    }
}

async function downloadFile(file: File, allowEncryptedCopy = false): Promise<boolean> {
    if (downloadState.active) {
        if (batchDownloadState === null) {
            showStatusMessage("Wait for the current download to finish.", "warning");
        }
        return false;
    }
    if (requiresEncryptedCopyConfirmation(file.likelyEncrypted, allowEncryptedCopy)) {
        showEncryptedCopyDownloadPrompt(file);
        return false;
    }

    downloadState.active = true;
    try {
        await runDownloadWithFailureCleanup(
            () => invoke("download_file", {key: file.key, filename: file.name, encrypted: file.encrypted}),
            cleanupFailedDownload,
        );
        return true;
    } catch (e) {
        console.error("Download failed:", e);
        const msg = String(e).toLowerCase().includes("aead")
            ? "Encryption passphrase does not match"
            : String(e);
        showStatusMessage(msg, "error");
        return false;
    }
}

function showEncryptedCopyDownloadPrompt(file: File): void {
    const prompt = getLikelyEncryptedDownloadPrompt();
    const modal = document.getElementById("encrypted-copy-download-modal")!;
    const filename = document.getElementById("encrypted-copy-download-filename")!;

    pendingEncryptedCopyDownload = file;
    document.getElementById("encrypted-copy-download-title")!.textContent = prompt.title;
    document.getElementById("encrypted-copy-download-message")!.textContent = prompt.message;
    const confirmButton = document.getElementById("encrypted-copy-download-confirm") as HTMLButtonElement;
    confirmButton.textContent = prompt.confirmLabel;
    filename.textContent = file.name;
    filename.title = file.name;
    modal.classList.remove("hidden");
    confirmButton.focus();
}

function hideEncryptedCopyDownloadPrompt(): void {
    pendingEncryptedCopyDownload = null;
    document.getElementById("encrypted-copy-download-modal")!.classList.add("hidden");
}

async function confirmEncryptedCopyDownload(): Promise<void> {
    const file = pendingEncryptedCopyDownload;
    if (!file) return;

    hideEncryptedCopyDownloadPrompt();
    await downloadFile(file, true);
}

function setupEncryptedCopyDownloadModal(): void {
    const modal = document.getElementById("encrypted-copy-download-modal")!;
    document
        .getElementById("encrypted-copy-download-cancel")
        ?.addEventListener("click", hideEncryptedCopyDownloadPrompt);
    document
        .getElementById("encrypted-copy-download-confirm")
        ?.addEventListener("click", confirmEncryptedCopyDownload);
    modal.addEventListener("click", event => {
        if (event.target === modal) {
            hideEncryptedCopyDownloadPrompt();
        }
    });
}

function showDownloadAllConfirmation(files: File[]): void {
    if (files.length === 0) return;

    const likelyEncryptedCount = files.filter(file => file.likelyEncrypted).length;
    const prompt = getDownloadAllPrompt(files.length, likelyEncryptedCount);
    const warning = document.getElementById("download-all-warning")!;

    pendingDownloadAllFiles = [...files];
    document.getElementById("download-all-title")!.textContent = prompt.title;
    document.getElementById("download-all-message")!.textContent = prompt.message;
    warning.textContent = prompt.warning ?? "";
    warning.classList.toggle("hidden", prompt.warning === null);
    const confirmButton = document.getElementById("download-all-confirm") as HTMLButtonElement;
    confirmButton.textContent = prompt.confirmLabel;
    document.getElementById("download-all-modal")!.classList.remove("hidden");
    confirmButton.focus();
}

function hideDownloadAllConfirmation(): void {
    pendingDownloadAllFiles = [];
    document.getElementById("download-all-modal")!.classList.add("hidden");
    (document.getElementById("file-list") as HTMLElement).focus();
}

async function waitForDownloadIdle(): Promise<void> {
    if (!downloadState.active) return;

    await new Promise<void>(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            downloadIdleResolvers.delete(finish);
            clearTimeout(timeout);
            resolve();
        };
        const timeout = setTimeout(() => {
            if (downloadState.active) {
                clearCurrentDownloadState();
                updateDownloadUI();
            }
            finish();
        }, 2000);

        downloadIdleResolvers.add(finish);
        if (!downloadState.active) {
            finish();
        }
    });
}

async function runDownloadAll(files: File[]): Promise<void> {
    if (downloadState.active || batchDownloadState !== null) {
        showStatusMessage("Wait for the current download to finish.", "warning");
        return;
    }

    const state: BatchDownloadState = {
        processed: 0,
        total: files.length,
        overlayDismissed: false,
    };
    batchDownloadState = state;
    let completed = 0;
    let failed = 0;

    try {
        showDownloadOverlay();
        updateDownloadUI();

        for (let index = 0; index < files.length; index++) {
            const file = files[index];
            const succeeded = await downloadFile(file, file.likelyEncrypted);
            if (succeeded) {
                completed++;
            } else {
                failed++;
            }
            await waitForDownloadIdle();
            state.processed = index + 1;
            updateDownloadUI();
        }

        await hideCompletedDownloadAfterDelay(() => {
            resetDownloadProgress();
            document.getElementById("download-title")!.textContent = "Downloading";
        });
    } finally {
        batchDownloadState = null;
    }

    const completionAlert = getDownloadAllCompletionAlert(files.length, completed, failed);
    if (completionAlert !== null) {
        showStatusMessage(completionAlert.message, completionAlert.type, completionAlert.durationMs);
    }
}

async function confirmDownloadAll(): Promise<void> {
    const files = [...pendingDownloadAllFiles];
    if (files.length === 0) return;

    hideDownloadAllConfirmation();
    await runDownloadAll(files);
}

function setupDownloadAllModal(): void {
    const modal = document.getElementById("download-all-modal")!;
    document
        .getElementById("download-all-cancel")
        ?.addEventListener("click", hideDownloadAllConfirmation);
    document
        .getElementById("download-all-confirm")
        ?.addEventListener("click", confirmDownloadAll);
    modal.addEventListener("click", event => {
        if (event.target === modal) {
            hideDownloadAllConfirmation();
        }
    });
}

async function deleteFile(file: File): Promise<void> {
    try {
        await invoke("delete_file", {
            key: file.key,
            isFolder: file.isFolder,
            allowMetadataDelete: file.isMetadata,
        });
        if (file.isMetadata) {
            await loadConfig();
        } else {
            await loadFiles(currentPath);
        }
    } catch (e) {
        console.error("Delete failed:", e);
        showStatusMessage(String(e), "error", 8000);
    }
}

function confirmDelete(file: File): void {
    const modal = document.getElementById("delete-confirm-modal")!;
    const message = document.getElementById("delete-confirm-message")!;
    const title = document.getElementById("delete-confirm-title")!;
    const warning = document.getElementById("delete-confirm-warning")!;
    const cancelBtn = document.getElementById("delete-confirm-cancel")!;
    const okBtn = document.getElementById("delete-confirm-ok")!;
    const prompt = getDeletePrompt(file);

    message.innerHTML = "";
    title.textContent = prompt.title;
    warning.textContent = prompt.warning ?? "";
    warning.classList.toggle("hidden", prompt.warning === null);
    okBtn.textContent = prompt.confirmLabel;
    const prefix = document.createElement("span");
    prefix.className = "delete-confirm-prefix";
    prefix.textContent = prompt.prefix;

    const filename = document.createElement("span");
    filename.className = "delete-confirm-filename";
    filename.textContent = file.name;
    filename.title = file.name;

    const suffix = document.createElement("span");
    suffix.className = "delete-confirm-suffix";
    suffix.textContent = prompt.suffix;

    message.append(prefix, filename, suffix);

    modal.classList.remove("hidden");
    (okBtn as HTMLButtonElement).focus();
    filename.classList.toggle(
        "is-truncated",
        isTextOverflowing(filename.scrollWidth, filename.clientWidth),
    );

    const cleanup = () => {
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        okBtn.replaceWith(okBtn.cloneNode(true));
    };

    cancelBtn.addEventListener("click", () => {
        modal.classList.add("hidden");
        cleanup();
    }, {once: true});

    okBtn.addEventListener("click", () => {
        modal.classList.add("hidden");
        cleanup();
        deleteFile(file);
    }, {once: true});

    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.add("hidden");
            cleanup();
        }
    }, {once: true});
}

async function handleConnection() {
    const endpoint = (document.getElementById("endpoint") as HTMLInputElement).value.trim();
    const bucket = (document.getElementById("bucket") as HTMLInputElement).value.trim();
    const region = (document.getElementById("region") as HTMLInputElement).value.trim();
    const accessKey = (document.getElementById("access-key") as HTMLInputElement).value.trim();
    let secretKey: string | undefined = (document.getElementById("secret-key") as HTMLInputElement).value;
    let encryptionPassphrase: string | undefined = (document.getElementById("encryption-passphrase") as HTMLInputElement).value;

    const errorEl = document.getElementById("setup-error")!;
    const btn = document.getElementById("btn-connect") as HTMLButtonElement;
    const endpointWarning = updateEndpointWarning();
    if (endpointWarning) {
        (document.getElementById("endpoint") as HTMLInputElement).focus();
        return;
    }

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

        currentBucket = bucket;
        if (await loadFiles("")) {
            showScreen("browser");
        }
    } catch (err) {
        errorEl.textContent = String(err);
        errorEl.classList.remove("hidden");
    } finally {
        btn.disabled = false;
        btn.textContent = "Connect";
    }
}

function updateEndpointWarning(): string | null {
    const endpoint = (document.getElementById("endpoint") as HTMLInputElement).value;
    const warning = getEndpointWarning(endpoint);
    const warningEl = document.getElementById("endpoint-warning")!;

    warningEl.textContent = warning ?? "";
    warningEl.classList.toggle("hidden", warning === null);
    return warning;
}

let pendingCredentialRemoval: CredentialRemovalKind | null = null;

function showCredentialRemovalPrompt(kind: CredentialRemovalKind): void {
    const prompt = getCredentialRemovalPrompt(kind);
    const modal = document.getElementById("credential-removal-modal")!;
    document.getElementById("credential-removal-title")!.textContent = prompt.title;
    document.getElementById("credential-removal-message")!.textContent = prompt.message;
    pendingCredentialRemoval = kind;
    modal.classList.remove("hidden");
    (document.getElementById("credential-removal-confirm") as HTMLButtonElement).focus();
}

function hideCredentialRemovalPrompt(): void {
    pendingCredentialRemoval = null;
    document.getElementById("credential-removal-modal")!.classList.add("hidden");
}

async function confirmCredentialRemoval(): Promise<void> {
    const kind = pendingCredentialRemoval;
    if (!kind) return;

    const confirmButton = document.getElementById("credential-removal-confirm") as HTMLButtonElement;
    const cancelButton = document.getElementById("credential-removal-cancel") as HTMLButtonElement;
    try {
        confirmButton.disabled = true;
        cancelButton.disabled = true;
        confirmButton.textContent = "Removing...";

        if (kind === "secret-key") {
            await invoke("clear_saved_secret_access_key");
            applyCredentialFieldState(
                "secret-key",
                "clear-secret-key",
                getSecretKeyFieldState(false),
            );
        } else {
            await invoke("clear_saved_encryption_passphrase");
            applyCredentialFieldState(
                "encryption-passphrase",
                "clear-encryption-passphrase",
                getPassphraseFieldState(false),
            );
        }

        hideCredentialRemovalPrompt();
    } catch (error) {
        showStatusMessage(String(error), "error", 8000);
    } finally {
        confirmButton.disabled = false;
        cancelButton.disabled = false;
        confirmButton.textContent = "Remove";
    }
}

function setupCredentialRemovalModal(): void {
    const modal = document.getElementById("credential-removal-modal")!;
    document
        .getElementById("credential-removal-cancel")
        ?.addEventListener("click", hideCredentialRemovalPrompt);
    document
        .getElementById("credential-removal-confirm")
        ?.addEventListener("click", confirmCredentialRemoval);
    modal.addEventListener("click", event => {
        const confirmButton = document.getElementById(
            "credential-removal-confirm",
        ) as HTMLButtonElement;
        if (event.target === modal && !confirmButton.disabled) {
            hideCredentialRemovalPrompt();
        }
    });
}

function setUpConnScreen() {
    document.getElementById("setup-form")?.addEventListener("submit", async (e) => {
        e.preventDefault()
        await handleConnection()
    });

    document.getElementById("endpoint")?.addEventListener("input", updateEndpointWarning);
    document
        .getElementById("clear-secret-key")
        ?.addEventListener("click", () => showCredentialRemovalPrompt("secret-key"));
    document.getElementById("clear-encryption-passphrase")?.addEventListener(
        "click",
        () => showCredentialRemovalPrompt("passphrase"),
    );
}

function showScreen(screen: AppScreen) {
    const searchInput = document.getElementById("search-input") as HTMLInputElement;
    searchInput.value = getSearchQueryAfterScreenChange(screen, searchInput.value);
    const nextFiles = getCachedFilesAfterScreenChange(screen, currentFiles);
    if (nextFiles !== currentFiles) {
        currentFiles = nextFiles;
        renderFiles([]);
    }
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

    for (const [id, state] of uploadStates) {
        const existing = list.querySelector<HTMLElement>(`[data-upload-id="${id}"]`);
        if (existing) {
            updateUploadItem(existing, state);
        } else {
            list.appendChild(createUploadItem(id, state));
        }
    }

    for (const child of [...list.children] as HTMLElement[]) {
        if (!uploadStates.has(child.dataset.uploadId!)) {
            child.remove();
        }
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
    const uploadName = root.querySelector(".upload-name") as HTMLElement;
    uploadName.textContent = state.filename;
    uploadName.title = state.filename;
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

function updateUploadItem(root: HTMLElement, state: UploadState): void {
    const fill = root.querySelector(".upload-progress-fill") as HTMLElement;
    if (state.percent < 0) {
        fill.classList.add("indeterminate");
        fill.style.width = "";
    } else {
        fill.classList.remove("indeterminate");
        fill.style.width = `${state.percent}%`;
    }

    root.querySelector(".upload-icon")!.textContent = state.isFolder ? "📁" : "📄";
    const uploadName = root.querySelector(".upload-name") as HTMLElement;
    uploadName.textContent = state.filename;
    uploadName.title = state.filename;
    root.querySelector(".upload-percent")!.textContent = state.percent < 0 ? "" : `${state.percent}%`;

    const details = root.querySelector(".upload-details")!;
    details.innerHTML = "";
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
}

function showDownloadOverlay() {
    document.getElementById("download-overlay")!.classList.remove("hidden");
}

function hideDownloadOverlay() {
    document.getElementById("download-overlay")!.classList.add("hidden");
}

function resetDownloadProgress(): void {
    if (downloadCompletionTimer !== null) {
        clearTimeout(downloadCompletionTimer);
        downloadCompletionTimer = null;
    }
    hideDownloadOverlay();
    clearCurrentDownloadState();
}

function clearCurrentDownloadState(): void {
    downloadState = {
        active: false,
        filename: "",
        percent: -1,
        downloadedBytes: 0,
        totalBytes: 0,
    };
    notifyDownloadIdle();
}

function notifyDownloadIdle(): void {
    const resolvers = [...downloadIdleResolvers];
    downloadIdleResolvers.clear();
    for (const resolve of resolvers) {
        resolve();
    }
}

function cleanupFailedDownload(): void {
    if (batchDownloadState === null) {
        resetDownloadProgress();
        return;
    }

    clearCurrentDownloadState();
    updateDownloadUI();
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

    if (batchDownloadState !== null) {
        const progress = getBatchDownloadProgress(
            batchDownloadState.total,
            batchDownloadState.processed,
            downloadState.active ? downloadState.percent : null,
        );
        document.getElementById("download-title")!.textContent = progress.title;
        nameEl.textContent = progress.detail;
        nameEl.title = progress.detail;
        fillEl.classList.remove("indeterminate");
        fillEl.style.width = progress.percent + "%";
        percentEl.textContent = progress.percent + "%";
        sizeEl.classList.add("hidden");
        return;
    }

    nameEl.textContent = downloadState.filename;
    nameEl.title = downloadState.filename;

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
        if (batchDownloadState !== null) {
            batchDownloadState.overlayDismissed = true;
        }
        hideDownloadOverlay();
    });

    listen("download_start", (event: any) => {
        if (downloadCompletionTimer !== null) {
            clearTimeout(downloadCompletionTimer);
            downloadCompletionTimer = null;
        }
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
        if (batchDownloadState === null) {
            document.getElementById("download-title")!.textContent = "Downloading";
        }
        if (!batchDownloadState?.overlayDismissed) {
            showDownloadOverlay();
        }
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
        if (batchDownloadState !== null) {
            downloadState.active = false;
            notifyDownloadIdle();
        } else {
            downloadCompletionTimer = setTimeout(resetDownloadProgress, 1000);
        }
    });
}

function updateBreadcrumb(path: string): void {
    const el = document.getElementById("current-path")!;
    el.textContent = formatBucketPath(currentBucket, path);
}

function renderFiles(files: File[]): void {
    const list = document.getElementById("file-list")!;
    list.innerHTML = "";
    displayedFiles = files;
    selectedFile = null;
    selectedFileIndex = null;

    for (let i = 0; i < files.length; i++) {
        const item = createFileItem(files[i], i);
        list.appendChild(item);
    }
}

function selectFile(index: number): void {
    const list = document.getElementById("file-list")!;
    const items = list.querySelectorAll(".file-item");

    if (selectedFileIndex !== null && items[selectedFileIndex]) {
        items[selectedFileIndex].classList.remove("selected");
    }

    if (index < 0 || index >= displayedFiles.length) return;

    selectedFileIndex = index;
    selectedFile = displayedFiles[index];
    items[index].classList.add("selected");
    (items[index] as HTMLElement).scrollIntoView({block: "nearest"});
}

function clearSelection(): void {
    if (selectedFileIndex !== null) {
        const list = document.getElementById("file-list")!;
        const items = list.querySelectorAll(".file-item");
        if (items[selectedFileIndex]) {
            items[selectedFileIndex].classList.remove("selected");
        }
    }
    selectedFile = null;
    selectedFileIndex = null;
}

interface ContextMenuPosition {
    clientX: number;
    clientY: number;
}

function positionContextMenu(menu: HTMLElement, event: ContextMenuPosition): void {
    menu.classList.remove("hidden");
    const bounds = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8));
    const top = Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function showContextMenu(e: MouseEvent, file: File): void {
    e.preventDefault();
    selectedFile = file;

    const menu = document.getElementById("context-menu")!;
    const downloadBtn = document.getElementById("ctx-download")!;
    const shareBtn = document.getElementById("ctx-share")!;

    downloadBtn.classList.toggle("hidden", file.isFolder);
    shareBtn.classList.toggle("hidden", file.isFolder || file.isMetadata);

    positionContextMenu(menu, e);
}

function hideContextMenu(): void {
    document.getElementById("context-menu")!.classList.add("hidden");
    selectedFile = null;
}

function showBackgroundContextMenu(event: ContextMenuPosition, focusButton = false): void {
    const menu = document.getElementById("background-context-menu")!;
    const button = document.getElementById("ctx-download-all") as HTMLButtonElement;
    const files = selectDownloadAllFiles(displayedFiles);
    const unavailable = files.length === 0 || downloadState.active || batchDownloadState !== null;

    button.disabled = unavailable;
    button.textContent = files.length === 0
        ? "No Files to Download"
        : `⬇️ Download All Files (${files.length})`;
    positionContextMenu(menu, event);
    if (focusButton) {
        button.focus();
    }
}

function hideBackgroundContextMenu(): void {
    document.getElementById("background-context-menu")!.classList.add("hidden");
}

function setupContextMenu(): void {
    document.addEventListener("click", () => {
        hideContextMenu();
        hideBackgroundContextMenu();
    });
    document.addEventListener("contextmenu", (e) => {
        const target = e.target as HTMLElement;
        if (target.closest(".file-item")) {
            hideBackgroundContextMenu();
            return;
        }

        hideContextMenu();
        const isBrowserBackground = target.closest(".explorer-panel")
            && !target.closest("input, textarea, select, button, a");
        if (!isBrowserBackground) {
            hideBackgroundContextMenu();
            return;
        }

        e.preventDefault();
        showBackgroundContextMenu(e);
    });
    document.getElementById("file-list")?.addEventListener("keydown", event => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
            return;
        }

        event.preventDefault();
        hideContextMenu();
        const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
        showBackgroundContextMenu(
            {clientX: bounds.left + 24, clientY: bounds.top + 24},
            true,
        );
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape"
            && !document.getElementById("background-context-menu")!.classList.contains("hidden")) {
            event.preventDefault();
            hideBackgroundContextMenu();
            (document.getElementById("file-list") as HTMLElement).focus();
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
            confirmDelete(selectedFile);
        }
        hideContextMenu();
    });

    document.getElementById("ctx-share")?.addEventListener("click", () => {
        if (selectedFile && !selectedFile.isFolder) {
            showShareModal(selectedFile);
        }
        hideContextMenu();
    });

    document.getElementById("ctx-download-all")?.addEventListener("click", () => {
        const files = selectDownloadAllFiles(displayedFiles);
        hideBackgroundContextMenu();
        showDownloadAllConfirmation(files);
    });
}

function createFileItem(file: File, index: number): HTMLElement {
    const item = document.createElement("div");
    item.className = "file-item";

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = file.isFolder ? "📁" : "📄";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = file.name;
    name.title = file.name;

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
    } else if (file.likelyEncrypted) {
        const warningIcon = document.createElement("span");
        warningIcon.className = "likely-encrypted-icon";
        warningIcon.textContent = "⚠";
        warningIcon.setAttribute("role", "img");
        warningIcon.setAttribute(
            "aria-label",
            "Likely encrypted. The current passphrase cannot decrypt this file.",
        );
        const tooltip = document.createElement("span");
        tooltip.className = "likely-encrypted-tooltip";
        tooltip.id = `likely-encrypted-tooltip-${index}`;
        tooltip.setAttribute("role", "tooltip");
        tooltip.textContent = "Likely encrypted. The current passphrase cannot decrypt this file.";
        warningIcon.setAttribute("aria-describedby", tooltip.id);
        warningIcon.tabIndex = 0;
        warningIcon.appendChild(tooltip);
        item.appendChild(warningIcon);
    }

    item.appendChild(size);

    item.addEventListener("click", () => {
        selectFile(index);
    });
    item.addEventListener("dblclick", () => {
        handleFileClick(file);
    });
    item.addEventListener("contextmenu", (e) => {
        selectFile(index);
        showContextMenu(e, file);
    });
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
    if (!parts.length) {
        loadConfig().catch(error => {
            console.error(error);
            showStatusMessage(String(error), "error", 8000);
        });
        return;
    }
    parts.pop();
    loadFiles(parts.length ? parts.join("/") + "/" : "");
}

async function loadConfig(connectionError: string | null = null): Promise<void> {
    const config: Config = await invoke<Config>("get_config");
    currentBucket = config.storage.bucket;

    (document.getElementById("endpoint") as HTMLInputElement).value = config.storage.endpoint;
    (document.getElementById("bucket") as HTMLInputElement).value = config.storage.bucket;
    (document.getElementById("region") as HTMLInputElement).value = config.storage.region;
    (document.getElementById("access-key") as HTMLInputElement).value = config.access_key_id;

    applyCredentialFieldState(
        "secret-key",
        "clear-secret-key",
        getSecretKeyFieldState(config.has_secret),
    );
    applyCredentialFieldState(
        "encryption-passphrase",
        "clear-encryption-passphrase",
        getPassphraseFieldState(config.has_encryption_passphrase),
    );

    updateEndpointWarning();

    const errorEl = document.getElementById("setup-error")!;
    errorEl.textContent = connectionError ?? "";
    errorEl.classList.toggle("hidden", connectionError === null);

    showScreen("setup");
}

function applyCredentialFieldState(
    inputId: string,
    clearButtonId: string,
    state: CredentialFieldState,
): void {
    const input = document.getElementById(inputId) as HTMLInputElement;
    input.value = "";
    input.placeholder = state.placeholder;
    input.required = state.required;
    document.getElementById(clearButtonId)!.classList.toggle("hidden", !state.showClear);
}

function setUpSettingsButton(): void {
    document.getElementById("btn-settings")?.addEventListener("click", async () => {
        try {
            await loadConfig();
        } catch (err) {
            console.error(err);
            showStatusMessage(String(err), "error", 8000);
        }
    });
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

    uploadBtn.addEventListener("click", async () => {
        let hasPassphrase: boolean;
        try {
            hasPassphrase = await invoke<boolean>("has_encrypted_password");
        } catch (error) {
            console.error("Encryption check failed:", error);
            showStatusMessage(String(error), "error", 8000);
            return;
        }
        if (toggle.checked && !hasPassphrase) {
            showStatusMessage("Set an encryption passphrase in Settings before enabling encryption.", "error", 5 * 1000);
            await updateEncryptionAvailability();
            return;
        }

        modal.classList.add("hidden");
        await startUpload(toggle.checked);
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

async function updateEncryptionAvailability(): Promise<void> {
    const toggle = document.getElementById("encrypt-toggle") as HTMLInputElement;
    const label = document.getElementById("encrypt-toggle-label")!;
    const notice = document.getElementById("encrypt-unavailable")!;
    let hasPassphrase = false;
    try {
        hasPassphrase = await invoke<boolean>("has_encrypted_password");
    } catch (error) {
        console.error("Encryption check failed:", error);
        showStatusMessage(String(error), "error", 8000);
    }

    toggle.disabled = !hasPassphrase;
    if (!hasPassphrase) {
        toggle.checked = false;
    }
    label.classList.toggle("disabled", !hasPassphrase);
    notice.classList.toggle("hidden", hasPassphrase);
}

async function startUpload(encrypted: boolean): Promise<void> {
    const paths = pendingDropPaths;
    pendingDropPaths = [];

    if (paths.length === 0) {
        return;
    }

    if (encrypted) {
        try {
            await invoke("validate_encrypted_upload");
        } catch (error) {
            console.error("Encrypted upload blocked:", error);
            showStatusMessage(String(error), "error", 8000);
            return;
        }
    }

    const uploadPromises = paths.map((path) => {
        const filename = getFilenameFromPath(path);
        const targetPrefix = currentPath + filename;
        const uploadId = generateUploadId();
        return uploadPath(path, targetPrefix, uploadId, encrypted);
    });

    const results = await Promise.allSettled(uploadPromises);
    const failures = results.flatMap(result =>
        result.status === "rejected" ? [result.reason] : []
    );
    for (const message of getUniqueErrorMessages(failures)) {
        showStatusMessage(message, "error", 8000);
    }

    if (results.some(result => result.status === "fulfilled")) {
        await loadFiles(currentPath);
    }
}

async function handleFileDrop(paths: string[]): Promise<void> {
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
        const filename = getFilenameFromPath(path);
        item.textContent = filename;
        item.title = filename;
        fileListEl.appendChild(item);
    }

    await updateEncryptionAvailability();
    modal.classList.remove("hidden");
    (document.getElementById("encrypt-confirm-upload") as HTMLButtonElement).focus();
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
            showStatusMessage(String(e), "error", 8000);
        }
    });

    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.add("hidden");
    });
}

function setupKeyboardShortcuts(): void {
    document.addEventListener("keydown", (e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        if (document.querySelector(".modal:not(.hidden)")) return;
        if (document.getElementById("browser-screen")!.classList.contains("hidden")) return;

        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                selectFile(selectedFileIndex === null ? 0 : selectedFileIndex + 1);
                break;
            case "ArrowUp":
                e.preventDefault();
                if (selectedFileIndex !== null && selectedFileIndex > 0) {
                    selectFile(selectedFileIndex - 1);
                }
                break;
            case "Enter":
                if (selectedFile) {
                    handleFileClick(selectedFile);
                }
                break;
            case "Escape":
                clearSelection();
                break;
            case "Delete":
            case "Backspace":
                if (selectedFile) {
                    confirmDelete(selectedFile);
                }
                break;
            case "F5":
                e.preventDefault();
                loadFiles(currentPath);
                break;
            case "r":
                if (e.metaKey || e.ctrlKey) {
                    e.preventDefault();
                    loadFiles(currentPath);
                }
                break;
        }
    });
}

function setupEventListeners(): void {
    document.getElementById("btn-back")?.addEventListener("click", navigateUp);
    document.getElementById("btn-refresh")?.addEventListener("click", async () => {
        const button = document.getElementById("btn-refresh") as HTMLButtonElement;
        await runRefreshWithFeedback(
            () => loadFiles(currentPath),
            state => {
                button.textContent = state.label;
                button.disabled = state.disabled;
            },
        );
    });

    document.getElementById("search-input")?.addEventListener("input", () => {
        applyFilters();
    });

    const filterBtn = document.getElementById("btn-filter")!;
    const filterBar = document.getElementById("filter-bar")!;

    filterBtn.addEventListener("click", () => {
        const open = filterBar.classList.toggle("hidden");
        filterBtn.classList.toggle("active", !open);
    });

    const filterType = document.getElementById("filter-type") as HTMLSelectElement;
    const filterEncryption = document.getElementById("filter-encryption") as HTMLSelectElement;
    const filterSize = document.getElementById("filter-size") as HTMLSelectElement;

    filterType.addEventListener("change", () => {
        activeFilters.type = filterType.value as FilterState["type"];
        applyFilters();
    });
    filterEncryption.addEventListener("change", () => {
        activeFilters.encryption = filterEncryption.value as FilterState["encryption"];
        applyFilters();
    });
    filterSize.addEventListener("change", () => {
        activeFilters.size = filterSize.value as FilterState["size"];
        applyFilters();
    });

    const sortSelect = document.getElementById("sort-select") as HTMLSelectElement;
    sortSelect.addEventListener("change", () => {
        activeSort = sortSelect.value as SortKey;
        applyFilters();
    });
}

function showShareModal(file: File): void {
    const modal = document.getElementById("share-modal")!;
    const filenameEl = document.getElementById("share-filename")!;
    const urlContainer = document.getElementById("share-url-container")!;
    const urlInput = document.getElementById("share-url") as HTMLInputElement;
    const errorEl = document.getElementById("share-error")!;
    const generateBtn = document.getElementById("share-generate") as HTMLButtonElement;

    filenameEl.textContent = file.name;
    filenameEl.title = file.name;
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
    generateBtn.focus();
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

            urlInput.value = await invoke<string>("generate_presigned_url", {
                key: fileKey,
                expirySecs,
            });
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
    init().catch(error => {
        console.error(error);
        showStatusMessage(String(error), "error", 8000);
    });
});

listen<DropPayload>("tauri://drag-drop", (event) => {
    handleFileDrop(event.payload.paths);
});
