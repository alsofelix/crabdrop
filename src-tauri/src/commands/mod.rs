use crate::crypto::{decrypt_chunk, derive_key, encrypt};
use crate::s3::S3Client;
use crate::types::UiConfig;
use crate::{config, metadata, types};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

const CHUNK_TOTAL: usize = 24 + (1024 * 1024) + 16;

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
    secret_key: Option<String>,
    encryption_passphrase: Option<String>,
) -> Result<(), String> {
    let mut config_curr = config::Config::load().map_err(|e| e.to_string())?;

    config_curr.storage.endpoint = endpoint;
    config_curr.storage.bucket = bucket;
    config_curr.storage.region = region;
    config_curr.credentials.access_key_id = access_key;

    if let Some(x) = secret_key.filter(|x1| !x1.trim().is_empty()) {
        config_curr.credentials.secret_access_key = x;
    }
    if let Some(x) = encryption_passphrase.filter(|x1| !x1.trim().is_empty()) {
        config_curr.credentials.encryption_passphrase = x;
    }
    config_curr.save().map_err(|e| e.to_string())?;
    let mut guard = state.lock().await;
    let client = S3Client::new(&config_curr).map_err(|e1| e1.to_string())?;
    *guard = Some(client);
    Ok(())
}

#[tauri::command]
pub async fn get_config() -> Result<types::UiConfig, String> {
    let config = config::Config::load().map_err(|e| e.to_string())?;

    let ui_config = UiConfig {
        storage: config.storage,
        access_key_id: config.credentials.access_key_id,
        has_secret: !config.credentials.secret_access_key.is_empty(),
        has_encryption_passphrase: !config.credentials.encryption_passphrase.is_empty(),
    };

    Ok(ui_config)
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
    upload_id: String,
    encrypted: bool,
) -> Result<(), String> {
    let client = {
        let guard = state.lock().await;
        guard.as_ref().ok_or("Not configured")?.clone()
    };

    let path = Path::new(&local_path);

    let mut password: Option<&[u8]> = None;

    let config = if encrypted {
        Some(config::Config::load().map_err(|e| e.to_string())?)
    } else {
        None
    };

    if encrypted {
        password = Some(
            config
                .as_ref()
                .ok_or(String::from("NO CONFIG OK??"))?
                .credentials
                .encryption_passphrase
                .as_bytes(),
        );
    }

    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;

    if metadata.is_file() {
        client
            .det_upload(
                &target_prefix,
                path,
                &app,
                true,
                &upload_id,
                encrypted,
                password,
            )
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
                "uploadId": upload_id,
                "filename": path.file_name().ok_or("Invalid path")?.to_string_lossy(),
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
                let key = format!(
                    "{}/{}",
                    target_prefix,
                    relative.to_string_lossy().replace("\\", "/")
                );

                app.emit(
                    "folder_progress",
                    serde_json::json!({
                        "uploadId": upload_id,
                        "filename": relative.to_string_lossy(),
                        "currentFile": x,
                        "totalFiles": total_files,
                    }),
                )
                .ok();

                client
                    .det_upload(
                        &key, file_path, &app, false, &upload_id, encrypted, password,
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                x += 1;
            }
        }
        app.emit(
            "upload_complete",
            serde_json::json!({"uploadId": upload_id}),
        )
        .ok();
        Ok(())
    } else {
        Err("Unable to add file".to_string())
    }
}

#[tauri::command]
pub async fn download_file(
    app: tauri::AppHandle,
    state: State<'_, Arc<Mutex<Option<S3Client>>>>,
    key: &str,
    filename: &str,
    encrypted: bool,
) -> Result<(), String> {
    let guard = state.lock().await;
    let client = guard.as_ref().ok_or("Not configured")?;

    let download_dir = dirs::download_dir().ok_or("No download dir")?;
    let file = client.download_file(key).await.map_err(|e| e.to_string())?;

    let (lower, upper) = file.size_hint();
    let total_bytes = upper.unwrap_or(lower);

    let mut body = file.into_async_read();

    let file_path = get_unique_path(&download_dir, filename);
    let temp_path =
        file_path.with_extension(match file_path.extension().and_then(|e| e.to_str()) {
            Some(ext) => format!("{ext}.crabdroptemp"),
            None => String::from("crabdroptemp"),
        });
    app.emit(
        "download_start",
        serde_json::json!({
            "filename": filename,
            "totalBytes": total_bytes,
        }),
    )
    .ok();

    let std_file = std::fs::File::create(&temp_path).map_err(|e| e.to_string())?;
    let mut writer = tokio::io::BufWriter::new(tokio::fs::File::from_std(std_file));

    let mut buffer = vec![0u8; 1024 * 1024];
    let mut downloaded: u64 = 0;
    let mut buf_decrypt: Vec<u8> = Vec::new();

    let config = config::Config::load().map_err(|e| e.to_string())?;
    let metadata = client
        .get_metadata(config.credentials.encryption_passphrase.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    let mut filename = if key.contains("/") {
        key.rsplit_once("/")
            .map(|(_, right)| right)
            .ok_or("Bad thing")?
            .to_string()
    } else {
        key.to_string()
    };

    if encrypted {
        filename = metadata::get_filename(&metadata, &filename).map_err(|e| e.to_string())?;
    }

    let enc_key = derive_key(
        config.credentials.encryption_passphrase.as_bytes(),
        filename.as_bytes(),
    )
    .map_err(|e| e.to_string())?;
    loop {
        let n = body.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }

        if !encrypted {
            writer
                .write_all(&buffer[..n])
                .await
                .map_err(|e| e.to_string())?;
            downloaded += n as u64;
            app.emit(
                "download_progress",
                serde_json::json!({
                    "filename": filename,
                    "downloadedBytes": downloaded,
                    "totalBytes": total_bytes,
                }),
            )
            .ok();
            continue;
        }

        buf_decrypt.extend(&buffer[..n]);

        while buf_decrypt.len() >= CHUNK_TOTAL {
            let mut chunk = buf_decrypt.drain(..CHUNK_TOTAL).collect::<Vec<u8>>();
            println!("might not   ddddd");
            decrypt_chunk(&mut chunk, &enc_key).map_err(|e| e.to_string())?;
            println!("wow");
            writer.write_all(&chunk).await.map_err(|e| e.to_string())?;
        }
        downloaded += n as u64;

        app.emit(
            "download_progress",
            serde_json::json!({
                "filename": filename,
                "downloadedBytes": downloaded,
                "totalBytes": total_bytes,
            }),
        )
        .ok();
    }

    if !buf_decrypt.is_empty() {
        println!("bonjour be here");
        let mut chunk = buf_decrypt;
        decrypt_chunk(&mut chunk, &enc_key).map_err(|e| e.to_string())?;
        writer.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }

    writer.flush().await.map_err(|e| e.to_string())?;

    std::fs::rename(&temp_path, &file_path).map_err(|e| e.to_string())?;
    app.emit(
        "download_complete",
        serde_json::json!({
            "filename": filename,
            "totalBytes": downloaded,
        }),
    )
    .ok();
    Ok(())
}

#[tauri::command]
pub async fn delete_file(
    state: State<'_, Arc<Mutex<Option<S3Client>>>>,
    key: &str,
    is_folder: bool,
) -> Result<(), String> {
    let guard = state.lock().await;
    let client = guard.as_ref().ok_or("Not configured")?;

    if is_folder {
        client.delete_prefix(key).await.map_err(|e| e.to_string())?;
        return Ok(());
    }

    client.delete_file(key).await.map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn generate_presigned_url(
    state: State<'_, Arc<Mutex<Option<S3Client>>>>,
    key: &str,
    expiry_secs: u64,
) -> Result<String, String> {
    let guard = state.lock().await;
    let client = guard.as_ref().ok_or("Not configured")?;

    let url = client
        .gen_presigned_url(key, expiry_secs)
        .await
        .map_err(|e| e.to_string())?;

    Ok(url)
}
