const ENDPOINT_SCHEME_WARNING = "Endpoint URL must start with http:// or https://";

export type AppScreen = "setup" | "browser";
export type StatusMessageType = "error" | "warning";
export type ModalKeyboardAction = "primary" | "cancel" | "target-button" | null;

export interface ModalKeyboardInput {
    key: string;
    modalVisible: boolean;
    targetTag?: string;
    targetIsContentEditable?: boolean;
    targetIsModalButton?: boolean;
    repeat?: boolean;
    isComposing?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
}

export function getModalKeyboardAction(input: ModalKeyboardInput): ModalKeyboardAction {
    if (
        !input.modalVisible
        || input.repeat
        || input.isComposing
        || input.altKey
        || input.ctrlKey
        || input.metaKey
        || input.shiftKey
    ) {
        return null;
    }
    if (input.key === "Escape") {
        return "cancel";
    }
    if (input.key !== "Enter") {
        return null;
    }

    const targetTag = input.targetTag?.toUpperCase();
    if (
        input.targetIsContentEditable
        || targetTag === "A"
        || targetTag === "TEXTAREA"
    ) {
        return null;
    }
    if (targetTag === "BUTTON" && input.targetIsModalButton) {
        return "target-button";
    }

    return "primary";
}

export interface StatusMessagePresentation {
    className: string;
    role: "alert" | "status";
}

export function getStatusMessagePresentation(type: StatusMessageType): StatusMessagePresentation {
    return {
        className: `status-message status-message-${type}`,
        role: type === "error" ? "alert" : "status",
    };
}

export function getStatusMessageContainerId(screen: AppScreen): string {
    return screen === "browser"
        ? "browser-status-message-container"
        : "global-status-message-container";
}

export function getUniqueErrorMessages(errors: readonly unknown[]): string[] {
    return [...new Set(errors.map(error => String(error)))];
}

export interface StartupDestination {
    screen: AppScreen;
    error: string | null;
}

export interface CredentialFieldState {
    placeholder: string;
    required: boolean;
    showClear: boolean;
}

export type CredentialRemovalKind = "secret-key" | "passphrase";

export interface CredentialRemovalPrompt {
    title: string;
    message: string;
}

export function getCredentialRemovalPrompt(kind: CredentialRemovalKind): CredentialRemovalPrompt {
    if (kind === "secret-key") {
        return {
            title: "Remove Secret Access Key?",
            message: "Remove the saved Secret Access Key from Keychain? You will need to enter it again before reconnecting.",
        };
    }

    return {
        title: "Remove Encryption Passphrase?",
        message: "Remove the saved Encryption Passphrase from Keychain? Existing encrypted filenames and files will still require it, and crabdrop cannot recover it.",
    };
}

export function getSecretKeyFieldState(hasSavedValue: boolean): CredentialFieldState {
    return {
        placeholder: hasSavedValue
            ? "Saved in Keychain (leave blank to keep)"
            : "••••••••",
        required: !hasSavedValue,
        showClear: hasSavedValue,
    };
}

export function getPassphraseFieldState(hasSavedValue: boolean): CredentialFieldState {
    return {
        placeholder: hasSavedValue
            ? "Saved (leave blank to keep)"
            : "Encryption passphrase (optional)",
        required: false,
        showClear: hasSavedValue,
    };
}

export interface RefreshFeedbackState {
    label: "Refreshed" | "Refresh";
    disabled: boolean;
}

export async function runRefreshWithFeedback(
    refresh: () => Promise<boolean>,
    update: (state: RefreshFeedbackState) => void,
    pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 1000)),
): Promise<void> {
    update({label: "Refresh", disabled: true});
    try {
        if (await refresh()) {
            update({label: "Refreshed", disabled: true});
            await pause();
        }
    } finally {
        update({label: "Refresh", disabled: false});
    }
}

export function getEndpointWarning(endpoint: string): string | null {
    const value = endpoint.trim();
    if (value === "" || /^https?:\/\//i.test(value)) {
        return null;
    }
    return ENDPOINT_SCHEME_WARNING;
}

export function formatBucketPath(bucket: string, path: string): string {
    const bucketName = bucket.trim().replace(/^\/+|\/+$/g, "");
    const relativePath = path.replace(/^\/+/, "");
    return relativePath === "" ? `/${bucketName}/` : `/${bucketName}/${relativePath}`;
}

export function getSearchQueryAfterScreenChange(screen: AppScreen, query: string): string {
    return screen === "setup" ? "" : query;
}

export function matchesBrowserSearch(
    entry: {name: string; isMetadata: boolean},
    rawQuery: string,
): boolean {
    const query = rawQuery.trim().toLowerCase();

    if (entry.isMetadata) {
        const semanticQuery = query.replace(/[^a-z0-9]+/g, "");
        return semanticQuery.includes("metadata");
    }

    return query === "" || entry.name.toLowerCase().includes(query);
}

export function getCachedFilesAfterScreenChange<T>(screen: AppScreen, files: T[]): T[] {
    return screen === "setup" ? [] : files;
}

export interface LikelyEncryptedDownloadPrompt {
    title: string;
    message: string;
    confirmLabel: string;
}

export function getLikelyEncryptedDownloadPrompt(): LikelyEncryptedDownloadPrompt {
    return {
        title: "Download Encrypted Copy?",
        message: "This file cannot be decrypted with the current passphrase. The downloaded copy will remain encrypted and may be unreadable until you restore the correct passphrase.",
        confirmLabel: "Download Encrypted Copy",
    };
}

export function requiresEncryptedCopyConfirmation(
    likelyEncrypted: boolean,
    encryptedCopyApproved: boolean,
): boolean {
    return likelyEncrypted && !encryptedCopyApproved;
}

export interface DownloadAllPrompt {
    title: string;
    message: string;
    warning: string | null;
    confirmLabel: string;
}

export interface BatchDownloadProgress {
    title: string;
    detail: string;
    percent: number;
}

export interface DownloadAllCompletionAlert {
    message: string;
    type: "error";
    durationMs: number;
}

export function selectDownloadAllFiles<T extends {isFolder: boolean; isMetadata?: boolean}>(
    entries: readonly T[],
): T[] {
    return entries.filter(entry => !entry.isFolder && !entry.isMetadata);
}

export function getBatchDownloadProgress(
    totalFiles: number,
    processedFiles: number,
    currentFilePercent: number | null,
): BatchDownloadProgress {
    const total = Math.max(0, totalFiles);
    const processed = Math.min(total, Math.max(0, processedFiles));
    const currentProgress = currentFilePercent === null
        ? 0
        : Math.min(100, Math.max(0, currentFilePercent)) / 100;
    const percent = total === 0
        ? 0
        : Math.round(((processed + currentProgress) / total) * 100);
    const complete = Math.min(
        total,
        processed + (currentFilePercent !== null && currentFilePercent >= 100 ? 1 : 0),
    );
    const fileNoun = total === 1 ? "file" : "files";

    return {
        title: `Downloading ${total} ${fileNoun}`,
        detail: `${complete} of ${total} ${fileNoun} complete`,
        percent,
    };
}

export async function hideCompletedDownloadAfterDelay(
    hide: () => void,
    pause: (durationMs: number) => Promise<void> = durationMs =>
        new Promise(resolve => setTimeout(resolve, durationMs)),
): Promise<void> {
    await pause(800);
    hide();
}

export function isTextOverflowing(scrollWidth: number, clientWidth: number): boolean {
    return scrollWidth > clientWidth;
}

export interface DeletePrompt {
    title: string;
    prefix: string;
    suffix: string;
    warning: string | null;
    confirmLabel: string;
}

export function getDeletePrompt(entry: {isFolder: boolean; isMetadata: boolean}): DeletePrompt {
    if (entry.isMetadata) {
        return {
            title: "Delete Crabdrop Metadata?",
            prefix: "Delete \"",
            suffix: "\"?",
            warning: "Deleting this file removes Crabdrop's filename map for encrypted files. Existing encrypted files may become impossible to identify or decrypt. Download a backup first; without one, this cannot be undone.",
            confirmLabel: "Delete Metadata",
        };
    }

    return {
        title: "Delete",
        prefix: entry.isFolder ? "Delete folder \"" : "Delete \"",
        suffix: entry.isFolder ? "\" and all its contents?" : "\"?",
        warning: null,
        confirmLabel: "Delete",
    };
}

export function getDownloadAllCompletionAlert(
    totalFiles: number,
    completedFiles: number,
    failedFiles: number,
): DownloadAllCompletionAlert | null {
    if (failedFiles === 0) {
        return null;
    }

    return {
        message: `Downloaded ${completedFiles} of ${totalFiles} ${totalFiles === 1 ? "file" : "files"}. ${failedFiles} failed.`,
        type: "error",
        durationMs: 6000,
    };
}

export function getDownloadAllPrompt(fileCount: number, likelyEncryptedCount: number): DownloadAllPrompt {
    const fileNoun = fileCount === 1 ? "file" : "files";
    const warning = likelyEncryptedCount === 0
        ? null
        : likelyEncryptedCount === 1
            ? "1 likely encrypted file will be downloaded as an encrypted copy."
            : `${likelyEncryptedCount} likely encrypted files will be downloaded as encrypted copies.`;

    return {
        title: "Download All Files?",
        message: `Download ${fileCount} ${fileNoun} from this folder? Folders and everything inside them will be skipped.`,
        warning,
        confirmLabel: fileCount === 1 ? "Download File" : `Download ${fileCount} Files`,
    };
}

export async function runDownloadWithFailureCleanup(
    download: () => Promise<void>,
    cleanup: () => void,
): Promise<void> {
    try {
        await download();
    } catch (error) {
        cleanup();
        throw error;
    }
}

export async function determineStartupDestination(
    isConfigured: boolean,
    testConnection: () => Promise<void>,
    loadInitialFiles: () => Promise<boolean>,
): Promise<StartupDestination> {
    if (!isConfigured) {
        return {screen: "setup", error: null};
    }

    try {
        await testConnection();
        if (!await loadInitialFiles()) {
            return {screen: "setup", error: null};
        }
        return {screen: "browser", error: null};
    } catch (error) {
        return {screen: "setup", error: String(error)};
    }
}
