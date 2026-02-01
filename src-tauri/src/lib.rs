use crate::s3::S3Client;
use std::sync::Arc;
use tokio::sync::Mutex;

mod commands;
mod config;
mod s3;
mod types;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client_state = match config::Config::load() {
        Ok(config) if config.is_valid() => match S3Client::new(&config) {
            Ok(client) => Arc::new(Mutex::new(Some(client))),
            Err(_) => Arc::new(Mutex::new(None)),
        },
        _ => Arc::new(Mutex::new(None)),
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(client_state)
        .invoke_handler(tauri::generate_handler![
            commands::list_files,
            commands::check_config,
            commands::save_config,
            commands::test_connection,
            commands::get_config,
            commands::upload_folder,
            commands::upload_path,
            commands::download_file,
            commands::delete_file,
            commands::generate_presigned_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
