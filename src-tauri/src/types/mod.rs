use crate::config::StorageConfig;
use serde::Serialize;
use uuid::{Uuid, Version};

pub fn is_likely_encrypted_name(name: &str, metadata_available: bool) -> bool {
    !metadata_available
        && Uuid::parse_str(name)
            .map(|uuid| uuid.get_version() == Some(Version::Random))
            .unwrap_or(false)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct File {
    pub name: String,
    pub key: String,
    pub size: Option<i64>,
    pub is_folder: bool,
    pub last_modified: Option<i64>,

    #[serde(default)]
    pub encrypted: bool,

    #[serde(default)]
    pub likely_encrypted: bool,
}
#[derive(Serialize)]
pub struct UiConfig {
    pub storage: StorageConfig,
    pub access_key_id: String,
    pub has_secret: bool,
    pub has_encryption_passphrase: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_object_names_are_only_probable_encrypted_files_without_metadata() {
        let encrypted_name = "d891fe4b-6da9-4193-b4af-b78dd8c91835";

        assert!(is_likely_encrypted_name(encrypted_name, false));
        assert!(!is_likely_encrypted_name(encrypted_name, true));
        assert!(!is_likely_encrypted_name("quarterly-report.pdf", false));
    }
}
