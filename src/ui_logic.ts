const ENDPOINT_SCHEME_WARNING = "Endpoint URL must start with http:// or https://";

export type AppScreen = "setup" | "browser";

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
    successMessage: string;
}

export function getCredentialRemovalPrompt(kind: CredentialRemovalKind): CredentialRemovalPrompt {
    if (kind === "secret-key") {
        return {
            title: "Remove Secret Access Key?",
            message: "Remove the saved Secret Access Key from Keychain? You will need to enter it again before reconnecting.",
            successMessage: "Saved Secret Access Key removed from Keychain.",
        };
    }

    return {
        title: "Remove Encryption Passphrase?",
        message: "Remove the saved Encryption Passphrase from Keychain? Existing encrypted filenames and files will still require it, and crabdrop cannot recover it.",
        successMessage: "Saved Encryption Passphrase removed from Keychain.",
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

export function selectDownloadAllFiles<T extends {isFolder: boolean}>(entries: readonly T[]): T[] {
    return entries.filter(entry => !entry.isFolder);
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
): Promise<StartupDestination> {
    if (!isConfigured) {
        return {screen: "setup", error: null};
    }

    try {
        await testConnection();
        return {screen: "browser", error: null};
    } catch (error) {
        return {screen: "setup", error: String(error)};
    }
}
