use std::fs;
use std::path::Path;
use crate::s3::S3Client;
use tauri::State;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod config;
mod s3;
mod types;

#[tauri::command]
async fn list_files(s3: State<'_, S3Client>, prefix: &str) -> Result<Vec<types::File>, String>{
    s3.list_dir(prefix).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn upload_file(s3: State<'_, S3Client>, key: &str, path: &str) -> Result<(), String> {
    let file = fs::read(Path::new(path)).map_err(|e1| e1.to_string())?;

    s3.upload_file(key, file).await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config = config::Config::load().unwrap();
    let s3_client = S3Client::new(&config).unwrap();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(s3_client)
        .invoke_handler(tauri::generate_handler![list_files, upload_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
