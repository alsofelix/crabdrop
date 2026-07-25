const ENDPOINT_SCHEME_WARNING = "Endpoint URL must start with http:// or https://";

export interface StartupDestination {
    screen: "setup" | "browser";
    error: string | null;
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
    return relativePath === "" ? `/${bucketName}` : `/${bucketName}/${relativePath}`;
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
