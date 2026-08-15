import assert from "node:assert/strict";
import test from "node:test";

import {getTopmostVisibleModal} from "../src/modal_keyboard.ts";
import {
    determineStartupDestination,
    formatBucketPath,
    getBatchDownloadProgress,
    getCachedFilesAfterScreenChange,
    getCredentialRemovalPrompt,
    getDeletePrompt,
    getDownloadAllPrompt,
    getDownloadAllCompletionAlert,
    getPassphraseFieldState,
    getSecretKeyFieldState,
    getEndpointWarning,
    getLikelyEncryptedDownloadPrompt,
    getModalKeyboardAction,
    getSearchQueryAfterScreenChange,
    getStatusMessagePresentation,
    getStatusMessageContainerId,
    getUniqueErrorMessages,
    hideCompletedDownloadAfterDelay,
    isTextOverflowing,
    matchesBrowserSearch,
    requiresEncryptedCopyConfirmation,
    runDownloadWithFailureCleanup,
    runRefreshWithFeedback,
    selectDownloadAllFiles,
} from "../src/ui_logic.ts";

test("visible prompts map Enter to their primary action and Escape to cancel", () => {
    assert.equal(getModalKeyboardAction({
        key: "Enter",
        modalVisible: true,
        targetTag: "INPUT",
    }), "primary");
    assert.equal(getModalKeyboardAction({
        key: "Escape",
        modalVisible: true,
        targetTag: "BUTTON",
    }), "cancel");
    assert.equal(getModalKeyboardAction({
        key: "Enter",
        modalVisible: true,
        targetTag: "SELECT",
    }), "primary");
    assert.equal(getModalKeyboardAction({
        key: "Enter",
        modalVisible: true,
        targetTag: "BUTTON",
    }), "primary");
    assert.equal(getModalKeyboardAction({
        key: "Enter",
        modalVisible: true,
        targetTag: "BUTTON",
        targetIsModalButton: true,
    }), "target-button");
    assert.equal(getModalKeyboardAction({
        key: "Enter",
        modalVisible: false,
        targetTag: "INPUT",
    }), null);
});

test("prompt shortcuts ignore repeated, composing, modified, and native-control Enter keys", () => {
    for (const input of [
        {key: "Enter", modalVisible: true, repeat: true},
        {key: "Enter", modalVisible: true, isComposing: true},
        {key: "Enter", modalVisible: true, metaKey: true},
        {key: "Enter", modalVisible: true, targetTag: "TEXTAREA"},
        {key: "Enter", modalVisible: true, targetIsContentEditable: true},
        {key: "Tab", modalVisible: true},
    ]) {
        assert.equal(getModalKeyboardAction(input), null);
    }
});

test("prompt keyboard handling finds the visible upload modal when focus is elsewhere", () => {
    const hiddenModal = {
        id: "folder-modal",
        classList: {contains: (name: string) => name === "hidden"},
    };
    const uploadModal = {
        id: "encrypt-confirm-modal",
        classList: {contains: () => false},
    };

    assert.equal(
        getTopmostVisibleModal([hiddenModal, uploadModal]),
        uploadModal,
    );
});

test("errors use plain bottom status text instead of notification cards", () => {
    assert.deepEqual(getStatusMessagePresentation("error"), {
        className: "status-message status-message-error",
        role: "alert",
    });
    assert.deepEqual(getStatusMessagePresentation("warning"), {
        className: "status-message status-message-warning",
        role: "status",
    });
});

test("browser status messages use the area directly below the file list", () => {
    assert.equal(
        getStatusMessageContainerId("browser"),
        "browser-status-message-container",
    );
    assert.equal(
        getStatusMessageContainerId("setup"),
        "global-status-message-container",
    );
});

test("a batch upload reports repeated failures only once", () => {
    assert.deepEqual(
        getUniqueErrorMessages([
            new Error("Encryption passphrase does not match"),
            new Error("Encryption passphrase does not match"),
            new Error("Network unavailable"),
        ]),
        [
            "Error: Encryption passphrase does not match",
            "Error: Network unavailable",
        ],
    );
});

test("custom endpoints require an http or https scheme", () => {
    assert.equal(getEndpointWarning("s3.us-east-1.amazonaws.com"), "Endpoint URL must start with http:// or https://");
    assert.equal(getEndpointWarning("https://s3.us-east-1.amazonaws.com"), null);
    assert.equal(getEndpointWarning("http://localhost:9000"), null);
    assert.equal(getEndpointWarning(""), null);
});

test("working paths are rooted at the bucket name", () => {
    assert.equal(formatBucketPath("amzn-s3-demo-bucket", ""), "/amzn-s3-demo-bucket/");
    assert.equal(formatBucketPath("amzn-s3-demo-bucket", "photos/2026/"), "/amzn-s3-demo-bucket/photos/2026/");
    assert.equal(formatBucketPath(" amzn-s3-demo-bucket ", "/photos/"), "/amzn-s3-demo-bucket/photos/");
});

test("opening settings clears the browser search", () => {
    assert.equal(getSearchQueryAfterScreenChange("setup", "hetzner"), "");
    assert.equal(getSearchQueryAfterScreenChange("browser", "hetzner"), "hetzner");
});

test("crabdrop metadata is only revealed by an explicit metadata search", () => {
    const metadata = {
        name: "CRABDROP_METADATA_DO_NOT_DELETE",
        isMetadata: true,
    };

    for (const query of ["", "report", "meta"]) {
        assert.equal(matchesBrowserSearch(metadata, query), false);
    }
    for (const query of ["METADATA", "metadata", "meta data", "crabdrop_metadata"]) {
        assert.equal(matchesBrowserSearch(metadata, query), true);
    }
});

test("opening settings invalidates filenames decrypted with the previous passphrase", () => {
    const decryptedFiles = [
        {name: "test-file.png", encrypted: true},
    ];

    assert.deepEqual(getCachedFilesAfterScreenChange("setup", decryptedFiles), []);
    assert.deepEqual(
        getCachedFilesAfterScreenChange("browser", decryptedFiles),
        decryptedFiles,
    );
});

test("a failed startup connection returns the user to settings with the error", async () => {
    const destination = await determineStartupDestination(true, async () => {
        throw new Error("Bucket not found");
    }, async () => true);

    assert.deepEqual(destination, {
        screen: "setup",
        error: "Error: Bucket not found",
    });
});

test("a successful startup connection and listing open the browser", async () => {
    const destination = await determineStartupDestination(
        true,
        async () => undefined,
        async () => true,
    );

    assert.deepEqual(destination, {
        screen: "browser",
        error: null,
    });
});

test("a failed initial listing keeps startup in settings", async () => {
    const destination = await determineStartupDestination(
        true,
        async () => undefined,
        async () => false,
    );

    assert.deepEqual(destination, {
        screen: "setup",
        error: null,
    });
});

test("cleared credential fields return to their defaults and passphrases stay optional", () => {
    assert.deepEqual(getSecretKeyFieldState(false), {
        placeholder: "••••••••",
        required: true,
        showClear: false,
    });
    assert.deepEqual(getPassphraseFieldState(false), {
        placeholder: "Encryption passphrase (optional)",
        required: false,
        showClear: false,
    });
    assert.deepEqual(getSecretKeyFieldState(true), {
        placeholder: "Saved in Keychain (leave blank to keep)",
        required: false,
        showClear: true,
    });
    assert.deepEqual(getPassphraseFieldState(true), {
        placeholder: "Saved (leave blank to keep)",
        required: false,
        showClear: true,
    });
});

test("refresh feedback confirms completion before returning to idle", async () => {
    const states: string[] = [];

    await runRefreshWithFeedback(
        async () => {
            states.push("loaded");
            return true;
        },
        state => states.push(`${state.label}:${state.disabled}`),
        async () => {
            states.push("waited");
        },
    );

    assert.deepEqual(states, [
        "Refresh:true",
        "loaded",
        "Refreshed:true",
        "waited",
        "Refresh:false",
    ]);
});

test("a failed download closes and resets its progress panel", async () => {
    let panelVisible = true;
    let downloadActive = true;

    await assert.rejects(
        runDownloadWithFailureCleanup(
            async () => {
                throw new Error("Encryption passphrase does not match");
            },
            () => {
                panelVisible = false;
                downloadActive = false;
            },
        ),
        /Encryption passphrase does not match/,
    );

    assert.equal(panelVisible, false);
    assert.equal(downloadActive, false);
});

test("likely encrypted downloads clearly describe the encrypted copy", () => {
    assert.deepEqual(getLikelyEncryptedDownloadPrompt(), {
        title: "Download Encrypted Copy?",
        message: "This file cannot be decrypted with the current passphrase. The downloaded copy will remain encrypted and may be unreadable until you restore the correct passphrase.",
        confirmLabel: "Download Encrypted Copy",
    });
});

test("likely encrypted files require confirmation unless the encrypted copy was approved", () => {
    assert.equal(requiresEncryptedCopyConfirmation(true, false), true);
    assert.equal(requiresEncryptedCopyConfirmation(true, true), false);
    assert.equal(requiresEncryptedCopyConfirmation(false, false), false);
});

test("download all includes only files directly listed in the current folder", () => {
    const entries = [
        {name: "photo.jpg", isFolder: false},
        {name: "archive", isFolder: true},
        {name: "notes.txt", isFolder: false},
        {name: "CRABDROP_METADATA_DO_NOT_DELETE", isFolder: false, isMetadata: true},
    ];

    assert.deepEqual(selectDownloadAllFiles(entries), [
        {name: "photo.jpg", isFolder: false},
        {name: "notes.txt", isFolder: false},
    ]);
});

test("download all confirmation reports skipped folders and encrypted copies", () => {
    assert.deepEqual(getDownloadAllPrompt(3, 1), {
        title: "Download All Files?",
        message: "Download 3 files from this folder? Folders and everything inside them will be skipped.",
        warning: "1 likely encrypted file will be downloaded as an encrypted copy.",
        confirmLabel: "Download 3 Files",
    });
    assert.deepEqual(getDownloadAllPrompt(1, 0), {
        title: "Download All Files?",
        message: "Download 1 file from this folder? Folders and everything inside them will be skipped.",
        warning: null,
        confirmLabel: "Download File",
    });
});

test("download all uses one aggregate progress status", () => {
    assert.deepEqual(getBatchDownloadProgress(3, 0, 20), {
        title: "Downloading 3 files",
        detail: "0 of 3 files complete",
        percent: 7,
    });
    assert.deepEqual(getBatchDownloadProgress(3, 1, 50), {
        title: "Downloading 3 files",
        detail: "1 of 3 files complete",
        percent: 50,
    });
});

test("download all reports partial failures as a bottom error", () => {
    assert.equal(getDownloadAllCompletionAlert(4, 4, 0), null);
    assert.deepEqual(getDownloadAllCompletionAlert(4, 3, 1), {
        message: "Downloaded 3 of 4 files. 1 failed.",
        type: "error",
        durationMs: 6000,
    });
    assert.deepEqual(getDownloadAllCompletionAlert(1, 0, 1), {
        message: "Downloaded 0 of 1 file. 1 failed.",
        type: "error",
        durationMs: 6000,
    });
});

test("a completed download all status remains visible for 0.8 seconds", async () => {
    const events: string[] = [];

    await hideCompletedDownloadAfterDelay(
        () => events.push("hidden"),
        async durationMs => {
            events.push(`waited:${durationMs}`);
        },
    );

    assert.deepEqual(events, ["waited:800", "hidden"]);
});

test("delete prompts only tighten the suffix when the filename is truncated", () => {
    assert.equal(isTextOverflowing(420, 240), true);
    assert.equal(isTextOverflowing(120, 240), false);
    assert.equal(isTextOverflowing(240, 240), false);
});

test("metadata deletion explains the bucket-wide encryption risk", () => {
    assert.deepEqual(getDeletePrompt({isFolder: false, isMetadata: true}), {
        title: "Delete Crabdrop Metadata?",
        prefix: "Delete \"",
        suffix: "\"?",
        warning: "Deleting this file removes Crabdrop's filename map for encrypted files. Existing encrypted files may become impossible to identify or decrypt. Download a backup first; without one, this cannot be undone.",
        confirmLabel: "Delete Metadata",
    });
    assert.deepEqual(getDeletePrompt({isFolder: true, isMetadata: false}), {
        title: "Delete",
        prefix: "Delete folder \"",
        suffix: "\" and all its contents?",
        warning: null,
        confirmLabel: "Delete",
    });
});

test("credential removal prompts explain exactly what will be removed", () => {
    assert.deepEqual(getCredentialRemovalPrompt("secret-key"), {
        title: "Remove Secret Access Key?",
        message: "Remove the saved Secret Access Key from Keychain? You will need to enter it again before reconnecting.",
    });
    assert.deepEqual(getCredentialRemovalPrompt("passphrase"), {
        title: "Remove Encryption Passphrase?",
        message: "Remove the saved Encryption Passphrase from Keychain? Existing encrypted filenames and files will still require it, and crabdrop cannot recover it.",
    });
});
