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


-- ============================================================================
-- MORE FOR CRITERION 3 - the evaluation form wants: (1) sensitive data identified, (2) an appropriate
-- technique, (3) encryption AND decryption demonstrated, (4) an explanation of how it protects the data.
--
-- (1) SENSITIVE DATA AND WHY
--     users.password_hash     login secret            -> bcrypt hash (one-way, salted). Never decrypted.
--     users.phone_enc         staff personal data     -> AES (reversible, key needed)
--     vendors.tin_enc         supplier tax ID         -> AES
--     payments.check_no_enc   payment reference       -> AES
-- (2) TECHNIQUE: MySQL AES_ENCRYPT / AES_DECRYPT with a 256-bit key = SHA2(ENC_KEY, 256). The key is in
--     .env, never in the database, so a stolen database file or backup contains only ciphertext.
--     (MySQL 8 can also use SET block_encryption_mode = 'aes-256-cbc' with a random IV; the XAMPP
--     MariaDB default is AES-128-ECB, which is what the app uses.)
-- (3) ENCRYPT and DECRYPT in SQL only:
-- ============================================================================
INSERT INTO vendors (name, contact, tin_enc)
VALUES ('Demo Supplier', '0917-555-0199', AES_ENCRYPT('999-999-999-000', @key));

-- Decrypt with the right key, and see NULL with the wrong key:
SELECT name,
       HEX(tin_enc)                                              AS stored,
       CAST(AES_DECRYPT(tin_enc, @key) AS CHAR)                  AS decrypted_right_key,
       CAST(AES_DECRYPT(tin_enc, SHA2('wrong', 256)) AS CHAR)    AS decrypted_wrong_key
FROM vendors WHERE name = 'Demo Supplier';

-- Search by an encrypted value without decrypting the whole table (same input + same key = same ciphertext):
SELECT id, name FROM vendors WHERE tin_enc = AES_ENCRYPT('999-999-999-000', @key);

-- Change the value (re-encrypt):
UPDATE vendors SET tin_enc = AES_ENCRYPT('888-888-888-000', @key) WHERE name = 'Demo Supplier';
SELECT name, CAST(AES_DECRYPT(tin_enc, @key) AS CHAR) AS decrypted FROM vendors WHERE name = 'Demo Supplier';

-- What a database administrator or thief sees without the key, versus a role that is not allowed to read it:
--   (run in a second session as the Engineer account: mysql -u rsci_engineer -p)
--   SELECT tin_enc FROM vendors;   -> ERROR 1143 SELECT command denied for column 'tin_enc'   (Criterion 4)
-- (4) HOW IT PROTECTS: encryption protects the data at rest (disk, backups, a copied database);
--     the column GRANTs in 02_roles.sql protect it in use (only Boss, Accountant and PO Officer may read it).

DELETE FROM vendors WHERE name = 'Demo Supplier';   -- clean up
