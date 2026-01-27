use crate::config::Config;
use crate::s3::S3Client;
use crate::{config, types};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, State};
use tokio::sync::Mutex;

fn get_unique_path(dir: &Path, filename: &str) -> PathBuf {
    let path = dir.join(filename);
    if !path.exists() {
        return path;
    }

    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let ext = Path::new(filename).extension().and_then(|s| s.to_str());

    let mut counter = 1;
    loop {
        let new_name = match ext {
            Some(e) => format!("{} ({}).{}", stem, counter, e),
            None => format!("{} ({})", stem, counter),
        };
        let new_path = dir.join(&new_name);
        if !new_path.exists() {
            return new_path;
        }
        counter += 1;
    }
}

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

#[tauri::command]
pub async fn upload_folder(
    state: State<'_, Arc<Mutex<Option<S3Client>>>>,
    key: &str,
) -> Result<(), String> {
    let guard = state.lock().await;
    let client = guard.as_ref().ok_or("Not configured")?;

    client.upload_folder(key).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn upload_path(
    app: tauri::AppHandle,
    state: State<'_, Arc<Mutex<Option<S3Client>>>>,
    local_path: String,
    target_prefix: String,
) -> Result<(), String> {
    let guard = state.lock().await;
    let client = guard.as_ref().ok_or("Not configured")?;

    let path = Path::new(&local_path);

    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;

    if metadata.is_file() {
        client
            .det_upload(&target_prefix, path, &app, true)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    } else if metadata.is_dir() {
        let total_files: usize = walkdir::WalkDir::new(path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .count();

        app.emit(
            "upload_start",
            serde_json::json!({
                "filename": path.file_name().unwrap().to_string_lossy(),
                "multipart": false,
                "isFolder": true,
                "totalFiles": total_files
            }),
        )
        .ok();
        let mut x = 1;
        for i in walkdir::WalkDir::new(path) {
            let entry = i.map_err(|e| e.to_string())?;

            if entry.file_type().is_file() {
                let file_path = entry.path();
                let relative = file_path.strip_prefix(path).map_err(|e| e.to_string())?;
                let key = format!("{}/{}", target_prefix, relative.to_string_lossy());

                app.emit(
                    "folder_progress",
                    serde_json::json!({
                        "filename": relative.to_string_lossy(),
                        "currentFile": x,
                        "totalFiles": total_files,
                    }),
                )
                .ok();

                client
                    .det_upload(&key, file_path, &app, false)
                    .await
                    .map_err(|e| e.to_string())?;
                x += 1;
            }
        }
        app.emit("upload_complete", serde_json::json!({})).ok();
        Ok(())
    } else {
        Err("Unable to add file".to_string())
    }
}

#[tauri::command]
pub async fn download_file(
    state: State<'_, Arc<Mutex<Option<S3Client>>>>,
    key: &str,
    filename: &str,
) -> Result<(), String> {
    let guard = state.lock().await;
    let client = guard.as_ref().ok_or("Not configured")?;

    let download_dir = dirs::download_dir().ok_or("No download dir")?;
    let file = client.download_file(key).await.map_err(|e| e.to_string())?;

    let file_path = get_unique_path(&download_dir, filename);

    std::fs::write(file_path, file).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_file(
    state: State<'_, Arc<Mutex<Option<S3Client>>>>,
    key: &str,
    is_folder: bool,
) -> Result<(), String> {
    
    if is_folder {
        // deleting folders not yet!
        return Ok(())
    }
    let guard = state.lock().await;
    let client = guard.as_ref().ok_or("Not configured")?;

    client.delete_file(key).await.map_err(|e| e.to_string())?;

    Ok(())
}

