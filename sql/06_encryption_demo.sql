-- ============================================================================
-- Criterion 3 - Database encryption. Run as root (phpMyAdmin / Workbench).
-- Replace the key below with ENC_KEY from .env.
-- ============================================================================
USE rsci_sql;

SET @key := SHA2('change-this-long-random-string', 256);

-- Vendor TIN as stored (unreadable) vs decrypted
SELECT name,
       HEX(tin_enc)                               AS stored,
       CAST(AES_DECRYPT(tin_enc, @key) AS CHAR)   AS decrypted
FROM vendors;

-- Check numbers recorded by the Accountant (appear after a P.O. is confirmed as purchased)
SELECT po_id,
       HEX(check_no_enc)                               AS stored,
       CAST(AES_DECRYPT(check_no_enc, @key) AS CHAR)   AS decrypted
FROM payments;

-- Wrong key returns NULL
SELECT name, CAST(AES_DECRYPT(tin_enc, SHA2('wrong-key', 256)) AS CHAR) AS decrypted
FROM vendors;

-- Passwords are bcrypt hashes (one-way), not encrypted
SELECT email, password_hash FROM users;

-- Phone numbers are encrypted too
SELECT name, HEX(phone_enc) AS stored, CAST(AES_DECRYPT(phone_enc, @key) AS CHAR) AS decrypted
FROM users;
