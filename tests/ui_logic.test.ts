import assert from "node:assert/strict";
import test from "node:test";

import {
    determineStartupDestination,
    formatBucketPath,
    getEndpointWarning,
} from "../src/ui_logic.ts";

test("custom endpoints require an http or https scheme", () => {
    assert.equal(getEndpointWarning("s3.us-east-1.amazonaws.com"), "Endpoint URL must start with http:// or https://");
    assert.equal(getEndpointWarning("https://s3.us-east-1.amazonaws.com"), null);
    assert.equal(getEndpointWarning("http://localhost:9000"), null);
    assert.equal(getEndpointWarning(""), null);
});

test("working paths are rooted at the bucket name", () => {
    assert.equal(formatBucketPath("amzn-s3-demo-bucket", ""), "/amzn-s3-demo-bucket");
    assert.equal(formatBucketPath("amzn-s3-demo-bucket", "photos/2026/"), "/amzn-s3-demo-bucket/photos/2026/");
    assert.equal(formatBucketPath(" amzn-s3-demo-bucket ", "/photos/"), "/amzn-s3-demo-bucket/photos/");
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
