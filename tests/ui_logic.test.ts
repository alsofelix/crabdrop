import assert from "node:assert/strict";
import test from "node:test";

import {
    determineStartupDestination,
    formatBucketPath,
    getCredentialRemovalPrompt,
    getPassphraseFieldState,
    getSecretKeyFieldState,
    getEndpointWarning,
    getLikelyEncryptedDownloadPrompt,
    getSearchQueryAfterScreenChange,
    requiresEncryptedCopyConfirmation,
    runDownloadWithFailureCleanup,
    runRefreshWithFeedback,
} from "../src/ui_logic.ts";

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

test("a failed startup connection returns the user to settings with the error", async () => {
    const destination = await determineStartupDestination(true, async () => {
        throw new Error("Bucket not found");
    });

    assert.deepEqual(destination, {
        screen: "setup",
        error: "Error: Bucket not found",
    });
});

test("a successful startup connection opens the browser", async () => {
    const destination = await determineStartupDestination(true, async () => undefined);

    assert.deepEqual(destination, {
        screen: "browser",
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

test("credential removal prompts explain exactly what will be removed", () => {
    assert.deepEqual(getCredentialRemovalPrompt("secret-key"), {
        title: "Remove Secret Access Key?",
        message: "Remove the saved Secret Access Key from Keychain? You will need to enter it again before reconnecting.",
        successMessage: "Saved Secret Access Key removed from Keychain.",
    });
    assert.deepEqual(getCredentialRemovalPrompt("passphrase"), {
        title: "Remove Encryption Passphrase?",
        message: "Remove the saved Encryption Passphrase from Keychain? Existing encrypted filenames and files will still require it, and crabdrop cannot recover it.",
        successMessage: "Saved Encryption Passphrase removed from Keychain.",
    });
});
