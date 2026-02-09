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
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    cipher
        .encrypt_in_place(&nonce, b"", data)
        .map_err(|e| anyhow!("{e}"))?;
    data.splice(0..0, nonce);
    Ok(Uuid::new_v4().to_string())
}

pub fn decrypt(data: &mut Vec<u8>, password: &[u8], salt: &[u8]) -> anyhow::Result<()> {
    let key = derive_key(password, salt)?;
    let nonce_bytes: [u8; 24] = data[..24].try_into()?;
    let nonce = XNonce::from_slice(&nonce_bytes);
    data.drain(..24);
    let cipher = XChaCha20Poly1305::new_from_slice(&key)?;
    cipher.decrypt_in_place(nonce, b"", data).map_err(|e| {
        println!("{}", e.to_string());
        anyhow::anyhow!("{e}")
    })?;
    Ok(())
}
