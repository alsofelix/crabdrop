use crate::config::StorageConfig;
use serde::Serialize;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct File {
    pub name: String,
    pub key: String,
    pub size: Option<i64>,
    pub is_folder: bool,
    pub last_modified: Option<i64>,
}
#[derive(Serialize)]
pub struct UiConfig {
    pub storage: StorageConfig,
    pub access_key_id: String,
    pub has_secret: bool,
}
