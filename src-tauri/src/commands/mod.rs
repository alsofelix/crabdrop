use crate::config::Config;
use crate::s3::S3Client;
use crate::{config, types};
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

#[tauri::command]
pub async fn save_config(
    state: State<'_, Arc<Mutex<Option<S3Client>>>>,
    endpoint: String,
    bucket: String,
    region: String,
    access_key: String,
    secret_key: String,
) -> Result<(), String> {
    let config = config::Config {
        storage: config::StorageConfig {
            endpoint,
            bucket,
            region,
        },
        credentials: config::CredentialsConfig {
            access_key_id: access_key,
            secret_access_key: secret_key,
        },
    };
    config.save().map_err(|e| e.to_string())?;
    let mut guard = state.lock().await;
    let client = S3Client::new(&config).map_err(|e1| e1.to_string())?;
    *guard = Some(client);
    Ok(())
}

#[tauri::command]
pub async fn get_config() -> Result<Config, String> {
    let config = config::Config::load().map_err(|e| e.to_string())?;

    Ok(config)
}

#[tauri::command]
pub async fn test_connection(state: State<'_, Arc<Mutex<Option<S3Client>>>>) -> Result<(), String> {
    let guard = state.lock().await;
    let client = guard.as_ref().ok_or("Not configured")?;

    client.list_dir("").await.map_err(|e| e.to_string())?;
    Ok(())
}
