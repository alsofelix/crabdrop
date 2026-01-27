// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod s3;
mod types;

fn main() {
    crabdrop_lib::run()
}
