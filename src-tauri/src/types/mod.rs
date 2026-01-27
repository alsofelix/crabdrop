use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct File {
    pub name: String,
    pub key: String,
    pub size: Option<i64>,
    pub is_folder: bool,
    pub last_modified: Option<i64>,
}
