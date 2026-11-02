package id.rangkai.booking.infra;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Enkripsi kolom sensitif penumpang (nama, NIK, kontak) dengan AES-256-GCM. */
public final class FieldCrypto {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private final SecretKeySpec key;

    public FieldCrypto(String base64Key) {
        byte[] raw = base64Key == null ? new byte[0] : Base64.getDecoder().decode(base64Key);
        if (raw.length != 32) throw new IllegalArgumentException("PII_KEY_BASE64 harus 32 byte dalam base64");
        key = new SecretKeySpec(raw, "AES");
    }

    public String encrypt(String plain) {
        if (plain == null) return null;
        try {
            byte[] iv = new byte[IV_BYTES];
            RANDOM.nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return "v1:" + Base64.getEncoder().encodeToString(ByteBuffer.allocate(iv.length + ct.length).put(iv).put(ct).array());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    public String decrypt(String blob) {
        if (blob == null) return null;
        try {
            byte[] raw = Base64.getDecoder().decode(blob.substring(3));
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, raw, 0, IV_BYTES));
            return new String(c.doFinal(raw, IV_BYTES, raw.length - IV_BYTES), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Gagal membuka data terenkripsi", e);
        }
    }
}
