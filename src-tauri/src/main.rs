// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod s3;
mod types;

#[tokio::main]

async fn main() {
    let config = config::Config::load();
    let s3 = s3::S3Client::new(&config.unwrap()).unwrap();
    let files = s3.list_dir("").await;
    println!("{:?}", files);
    // crabdrop_lib::run()
}
