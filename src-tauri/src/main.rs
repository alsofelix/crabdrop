#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[tokio::main]

async fn main() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
    crabdrop_lib::run()
}
