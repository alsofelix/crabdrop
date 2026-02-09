use anyhow::anyhow;
use argon2::Argon2;
use chacha20poly1305::aead::OsRng;
use chacha20poly1305::{AeadCore, AeadInPlace, KeyInit, XChaCha20Poly1305, XNonce};
use uuid::Uuid;

pub fn derive_key(password: &[u8], salt: &[u8]) -> anyhow::Result<[u8; 32]> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password, salt, &mut key)
        .map_err(|_| anyhow!("Error when pass"))?;
    Ok(key)
}

pub fn encrypt(data: &mut Vec<u8>, password: &[u8], salt: &[u8]) -> anyhow::Result<String> {
    let key = derive_key(password, salt)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|e| anyhow!("{e}"))?;
    let mut encrypted_dat: Vec<u8> = Vec::new();

    for chunk in data.chunks(1024 * 1024) {
        let mut buf = chunk.to_vec();

        let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);

        cipher
            .encrypt_in_place(&nonce, b"", &mut buf)
            .map_err(|e| anyhow!("{e}"))?;

        buf.splice(0..0, nonce);

        encrypted_dat.extend(buf.clone());
    }

    *data = encrypted_dat;
    Ok(Uuid::new_v4().to_string())
}

pub fn decrypt(data: &mut Vec<u8>, password: &[u8], salt: &[u8]) -> anyhow::Result<()> {
    let key = derive_key(password, salt)?;
    let mut encrypted_dat: Vec<u8> = Vec::new();

    for chunk in data.chunks(24 + (1024 * 1024) + 16) {
        let mut buf = chunk.to_vec();
        let nonce_bytes: [u8; 24] = buf[..24].try_into()?;
        buf.drain(..24);

        let nonce = XNonce::from_slice(&nonce_bytes);
        let cipher = XChaCha20Poly1305::new_from_slice(&key)?;
        cipher
            .decrypt_in_place(nonce, b"", &mut buf)
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        encrypted_dat.extend(buf);
    }
    *data = encrypted_dat;
    Ok(())
}

pub fn decrypt_chunk(data: &mut Vec<u8>, key: &[u8]) -> anyhow::Result<()> {
    let nonce_bytes: [u8; 24] = data[..24].try_into()?;
    let nonce = XNonce::from_slice(&nonce_bytes);
    data.drain(..24);
    let cipher = XChaCha20Poly1305::new_from_slice(&key)?;
    cipher.decrypt_in_place(nonce, b"", data).map_err(|e| {
        anyhow::anyhow!("{e}")
    })?;
    Ok(())
}
