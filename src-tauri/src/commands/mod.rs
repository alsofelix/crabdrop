use crate::s3::S3Client;
use crate::types;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

#[tauri::command]
pub async fn list_files(
    state: State<'_, Arc<Mutex<Option<S3Client>>>>,
    prefix: &str,
) -> Result<Vec<types::File>, String> {
    let guard = state.lock().await;
    let client = guard.as_ref().ok_or("Not configured")?;

    client.list_dir(prefix).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upload_file(
    state: State<'_, Arc<Mutex<Option<S3Client>>>>,
    key: &str,
    path: &str,
) -> Result<(), String> {
    let guard = state.lock().await;
    let client = guard.as_ref().ok_or("Not configured")?;

    let file = fs::read(Path::new(path)).map_err(|e1| e1.to_string())?;

    client
        .upload_file(key, file)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_config(state: State<'_, Arc<Mutex<Option<S3Client>>>>) -> Result<bool, String> {
    let guard = state.lock().await;
    Ok(guard.is_some())
}
