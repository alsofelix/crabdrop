use anyhow::anyhow;
use std::collections::HashMap;

pub fn get_filename(data: &[u8], file_uuid: &str) -> anyhow::Result<String> {
    let map: HashMap<String, String> = serde_json::from_slice(data).map_err(|e| anyhow!("{e}"))?;

    map.get(file_uuid)
        .cloned()
        .ok_or_else(|| anyhow!("Missing in metadata"))
}

pub fn put_filename(data: &[u8], uuid: &str, filename: &str) -> anyhow::Result<Vec<u8>> {
    let mut map: HashMap<String, String> =
        serde_json::from_slice(data).map_err(|e| anyhow!("{e}"))?;

    map.entry(uuid.to_string())
        .or_insert_with(|| filename.to_string());

    Ok(serde_json::to_string(&map)?.into_bytes())
}

pub fn is_in_meta(data: &[u8], uuid: &str) -> anyhow::Result<bool> {
    let map: HashMap<String, String> = serde_json::from_slice(data).map_err(|e| anyhow!("{e}"))?;
    Ok(map.contains_key(uuid))
}
