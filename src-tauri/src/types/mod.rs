use crate::config::StorageConfig;
use crate::metadata::CRABDROP_METADATA_FILE_NAME;
use serde::Serialize;
use uuid::{Uuid, Version};

pub fn is_crabdrop_metadata_key(key: &str) -> bool {
    key == CRABDROP_METADATA_FILE_NAME
}

pub fn is_likely_encrypted_name(name: &str, confirmed_encrypted: bool) -> bool {
    !confirmed_encrypted
        && Uuid::parse_str(name)
            .map(|uuid| uuid.get_version() == Some(Version::Random))
            .unwrap_or(false)
}

pub fn is_folder_marker_key(key: &str) -> bool {
    key.ends_with('/')
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

    #[serde(default)]
    pub is_metadata: bool,
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
    fn unmapped_uuid_object_names_remain_probable_encrypted_files() {
        let encrypted_name = "d891fe4b-6da9-4193-b4af-b78dd8c91835";

        assert!(is_likely_encrypted_name(encrypted_name, false));
        assert!(!is_likely_encrypted_name(encrypted_name, true));
        assert!(!is_likely_encrypted_name("quarterly-report.pdf", false));
    }

    #[test]
    fn folder_marker_keys_are_hidden_without_hiding_empty_files() {
        assert!(is_folder_marker_key("Test/"));
        assert!(is_folder_marker_key("parent/child/"));
        assert!(!is_folder_marker_key("empty.txt"));
        assert!(!is_folder_marker_key("parent/empty.txt"));
    }

    #[test]
    fn only_the_exact_root_metadata_key_is_treated_as_crabdrop_metadata() {
        assert!(is_crabdrop_metadata_key("CRABDROP_METADATA_DO_NOT_DELETE"));
        assert!(!is_crabdrop_metadata_key(
            "folder/CRABDROP_METADATA_DO_NOT_DELETE"
        ));
        assert!(!is_crabdrop_metadata_key("crabdrop_metadata_do_not_delete"));
    }
}
