package info.chainlens.magicmoney.passkey;

import org.bouncycastle.asn1.ASN1EncodableVector;
import org.bouncycastle.asn1.ASN1Integer;
import org.bouncycastle.asn1.DERSequence;
import org.bouncycastle.crypto.digests.SHA256Digest;
import org.bouncycastle.crypto.macs.HMac;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.crypto.params.ECPrivateKeyParameters;
import org.bouncycastle.crypto.params.KeyParameter;
import org.bouncycastle.crypto.signers.ECDSASigner;
import org.bouncycastle.crypto.signers.HMacDSAKCalculator;
import org.bouncycastle.crypto.ec.CustomNamedCurves;
import org.bouncycastle.crypto.params.ECNamedDomainParameters;
import org.bouncycastle.asn1.x9.X9ECParameters;
import org.bouncycastle.math.ec.ECPoint;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

/**
 * Java port of the FROZEN v1 derivation spec in
 * src/main/webauthn-authenticator.ts.
 *
 * ⚠ THIS FILE IS ONE HALF OF A CROSS-LANGUAGE CONTRACT. Every value it produces
 * must equal, byte for byte, what the TypeScript core produces — the shared
 * evidence is src/main/__fixtures__/webauthn-vectors.json, asserted by
 * WebAuthnVectorsTest. A divergence here does not throw; it silently mints a
 * DIFFERENT key, so a passkey created in the wallet's own browser would not open
 * in Chrome and the user's only recourse would be a seed phrase that no longer
 * works. Treat a red parity test as a release blocker.
 *
 *   webauthnRoot = HKDF-SHA256(ikm=BIP39seed, salt="magicmoney/webauthn",
 *                              info="v1" | "v1/<accountIndex>", len=32)
 *   macKey       = HKDF-Expand(webauthnRoot, info="cred-id-mac", len=32)
 *   priv         = HKDF-Expand(webauthnRoot, info=rpIdHash(32)||nonce(16)||ctr(1), 32)
 *                  rejection-sampled into [1, n-1]
 *   credId       = 0x01 || nonce(16) || HMAC-SHA256(macKey, rpIdHash||nonce)[0..15]
 *
 * SECURITY BOUNDARY: there is deliberately NO mnemonic-to-seed path in this
 * class. The provider is a background service any app's sign-in prompt can
 * reach, and it is only ever handed `webauthnRoot` (see RootStore). Giving it
 * the seed would put fund-spending authority behind a system binder. The test
 * source set has its own BIP-39 helper so the parity suite can still prove the
 * chain end to end.
 */
public final class WebAuthnCore {

    private WebAuthnCore() {}

    // ── Frozen constants (mirrors of the TypeScript ones) ────────────────────

    public static final String SPEC_VERSION = "v1";
    private static final String ROOT_SALT = "magicmoney/webauthn";
    private static final String MAC_KEY_INFO = "cred-id-mac";

    public static final byte CRED_ID_VERSION = 0x01;
    private static final int NONCE_LEN = 16;
    private static final int TAG_LEN = 16;
    public static final int CRED_ID_LEN = 1 + NONCE_LEN + TAG_LEN;

    /**
     * SHA-256("magicmoney/webauthn/aaguid/v1")[0..15]
     * = 2c4b3c62-a6fc-6b9f-47f2-4ede41f1b4bf
     *
     * Reported AS IS on this path, unlike the in-app browser shim which zeroes
     * it: blanking the AAGUID is the CLIENT's job, and here Chrome is the client
     * and does it for us. Zeroing twice would be a lie in the other direction.
     */
    public static final byte[] AAGUID = {
            (byte) 0x2c, (byte) 0x4b, (byte) 0x3c, (byte) 0x62,
            (byte) 0xa6, (byte) 0xfc, (byte) 0x6b, (byte) 0x9f,
            (byte) 0x47, (byte) 0xf2, (byte) 0x4e, (byte) 0xde,
            (byte) 0x41, (byte) 0xf1, (byte) 0xb4, (byte) 0xbf,
    };

    public static final int COSE_ALG_ES256 = -7;

    public static final byte FLAG_UP = 0x01;
    public static final byte FLAG_UV = 0x04;
    public static final byte FLAG_BE = 0x08;
    public static final byte FLAG_BS = 0x10;
    public static final byte FLAG_AT = 0x40;

    /** Fixed at 0 — a seed-derived credential legitimately lives on many devices. */
    public static final int SIGN_COUNT = 0;

    private static final X9ECParameters P256 = CustomNamedCurves.getByName("secp256r1");
    private static final ECDomainParameters P256_DOMAIN = new ECNamedDomainParameters(
            org.bouncycastle.asn1.x9.X9ObjectIdentifiers.prime256v1,
            P256.getCurve(), P256.getG(), P256.getN(), P256.getH());

    // ── Primitives ───────────────────────────────────────────────────────────

    public static byte[] sha256(byte[] input) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(input);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    public static byte[] hmacSha256(byte[] key, byte[] data) {
        HMac mac = new HMac(new SHA256Digest());
        mac.init(new KeyParameter(key));
        mac.update(data, 0, data.length);
        byte[] out = new byte[mac.getMacSize()];
        mac.doFinal(out, 0);
        return out;
    }

    /**
     * HKDF-Expand (RFC 5869 §2.3), written out rather than using BouncyCastle's
     * HKDFBytesGenerator: that class always performs an extract step unless fed a
     * "skip" parameter, and the frozen spec expands the root DIRECTLY as a PRK.
     * Getting that wrong yields plausible-looking bytes that match nothing.
     */
    public static byte[] hkdfExpand(byte[] prk, byte[] info, int length) {
        int hashLen = 32;
        int n = (length + hashLen - 1) / hashLen;
        if (n > 255) throw new IllegalArgumentException("HKDF: length too large");
        byte[] out = new byte[length];
        byte[] t = new byte[0];
        int copied = 0;
        for (int i = 1; i <= n; i++) {
            byte[] input = concat(t, info, new byte[]{(byte) i});
            t = hmacSha256(prk, input);
            int take = Math.min(hashLen, length - copied);
            System.arraycopy(t, 0, out, copied, take);
            copied += take;
        }
        return out;
    }

    /** Full HKDF (extract + expand). Used only by the test's seed path. */
    public static byte[] hkdf(byte[] ikm, byte[] salt, byte[] info, int length) {
        byte[] prk = hmacSha256(salt, ikm);   // HKDF-Extract
        return hkdfExpand(prk, info, length);
    }

    /**
     * The WebAuthn root for a wallet account, from a BIP-39 seed.
     *
     * ⚠ Present for the PARITY TEST only — production Java never holds a seed
     * (see the class comment). Kept here rather than in the test source set so
     * the frozen `info` encoding lives beside everything else it must match.
     */
    public static byte[] deriveWebauthnRootFromSeed(byte[] seed, int accountIndex) {
        if (accountIndex < 0) throw new IllegalArgumentException("accountIndex must be >= 0");
        String info = accountIndex == 0 ? SPEC_VERSION : SPEC_VERSION + "/" + accountIndex;
        return hkdf(seed, utf8(ROOT_SALT), utf8(info), 32);
    }

    public static byte[] deriveCredentialMacKey(byte[] root) {
        requireRoot(root);
        return hkdfExpand(root, utf8(MAC_KEY_INFO), 32);
    }

    public static byte[] rpIdHash(String rpId) {
        if (rpId == null || rpId.isEmpty()) throw new IllegalArgumentException("rpId must be non-empty");
        return sha256(utf8(rpId));
    }

    // ── Credential key ───────────────────────────────────────────────────────

    public static final class CredentialKey {
        public final byte[] privateKey;   // 32-byte scalar
        public final byte[] publicKey;    // uncompressed SEC1, 65 bytes
        public final byte[] x;
        public final byte[] y;
        public final int counter;

        CredentialKey(byte[] privateKey, byte[] publicKey, int counter) {
            this.privateKey = privateKey;
            this.publicKey = publicKey;
            this.x = Arrays.copyOfRange(publicKey, 1, 33);
            this.y = Arrays.copyOfRange(publicKey, 33, 65);
            this.counter = counter;
        }
    }

    /**
     * Deterministic in (root, rpId, nonce).
     *
     * The scalar is REJECTION-SAMPLED, not reduced mod n: reduction biases the
     * low end of the range, and the TypeScript side rejects too — a `mod n` here
     * would agree on almost every input and disagree on roughly one in four
     * billion, which is the worst possible failure mode to debug.
     */
    public static CredentialKey deriveCredentialKey(byte[] root, String rpId, byte[] nonce) {
        requireRoot(root);
        if (nonce == null || nonce.length != NONCE_LEN) {
            throw new IllegalArgumentException("nonce must be " + NONCE_LEN + " bytes");
        }
        byte[] rpHash = rpIdHash(rpId);
        BigInteger n = P256.getN();

        for (int counter = 0; counter <= 0xff; counter++) {
            byte[] info = concat(rpHash, nonce, new byte[]{(byte) counter});
            byte[] candidate = hkdfExpand(root, info, 32);
            BigInteger d = new BigInteger(1, candidate);
            if (d.signum() == 0 || d.compareTo(n) >= 0) continue;
            ECPoint q = P256.getG().multiply(d).normalize();
            return new CredentialKey(to32(d), q.getEncoded(false), counter);
        }
        throw new IllegalStateException("Credential key derivation failed: scalar rejection limit reached");
    }

    // ── Credential id (stateless, MAC-verified) ──────────────────────────────

    private static byte[] credentialTag(byte[] macKey, byte[] rpHash, byte[] nonce) {
        return Arrays.copyOf(hmacSha256(macKey, concat(rpHash, nonce)), TAG_LEN);
    }

    public static byte[] makeCredentialId(byte[] root, String rpId, byte[] nonce) {
        requireRoot(root);
        if (nonce == null || nonce.length != NONCE_LEN) {
            throw new IllegalArgumentException("nonce must be " + NONCE_LEN + " bytes");
        }
        byte[] tag = credentialTag(deriveCredentialMacKey(root), rpIdHash(rpId), nonce);
        return concat(new byte[]{CRED_ID_VERSION}, nonce, tag);
    }

    /**
     * Recover the nonce from a credentialId, or throw.
     *
     * THROWING IS THE POINT. A tampered id must never fall through to deriving
     * some other key — that would sign with a key the relying party has never
     * seen. Comparison is constant-time.
     */
    public static byte[] parseCredentialId(byte[] root, String rpId, byte[] credentialId) {
        requireRoot(root);
        if (credentialId == null || credentialId.length != CRED_ID_LEN) {
            throw new IllegalArgumentException("Unrecognised credential id: wrong length");
        }
        if (credentialId[0] != CRED_ID_VERSION) {
            throw new IllegalArgumentException("Unrecognised credential id: unsupported version");
        }
        byte[] nonce = Arrays.copyOfRange(credentialId, 1, 1 + NONCE_LEN);
        byte[] tag = Arrays.copyOfRange(credentialId, 1 + NONCE_LEN, CRED_ID_LEN);
        byte[] expected = credentialTag(deriveCredentialMacKey(root), rpIdHash(rpId), nonce);
        if (!MessageDigest.isEqual(tag, expected)) {
            throw new IllegalArgumentException("Unrecognised credential id: authentication tag mismatch");
        }
        return nonce;
    }

    /** Non-throwing probe: is this one of ours, for this RP and this wallet? */
    public static boolean isOwnCredentialId(byte[] root, String rpId, byte[] credentialId) {
        try {
            parseCredentialId(root, rpId, credentialId);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    // ── Minimal CBOR (majors 0,1,2,3,5 — all WebAuthn needs) ─────────────────

    static byte[] cborHead(int major, int value) {
        if (value < 0) throw new IllegalArgumentException("CBOR: invalid head value");
        int mt = major << 5;
        if (value < 24) return new byte[]{(byte) (mt | value)};
        if (value < 0x100) return new byte[]{(byte) (mt | 24), (byte) value};
        if (value < 0x10000) return new byte[]{(byte) (mt | 25), (byte) (value >> 8), (byte) value};
        return new byte[]{(byte) (mt | 26), (byte) (value >>> 24), (byte) (value >>> 16),
                (byte) (value >>> 8), (byte) value};
    }

    public static byte[] cborInt(int n) {
        return n < 0 ? cborHead(1, -n - 1) : cborHead(0, n);
    }

    public static byte[] cborBytes(byte[] b) {
        return concat(cborHead(2, b.length), b);
    }

    public static byte[] cborText(String s) {
        byte[] b = utf8(s);
        return concat(cborHead(3, b.length), b);
    }

    /** Entries are pre-encoded and emitted in order; callers keep CTAP2 canonical order. */
    public static byte[] cborMap(byte[][]... entries) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        write(out, cborHead(5, entries.length));
        for (byte[][] kv : entries) {
            write(out, kv[0]);
            write(out, kv[1]);
        }
        return out.toByteArray();
    }

    /**
     * COSE_Key for EC2 P-256: {1:2, 3:-7, -1:1, -2:x, -3:y}, in CTAP2 canonical
     * order (labels 1, 3, -1, -2, -3 encode as 0x01 < 0x03 < 0x20 < 0x21 < 0x22).
     */
    public static byte[] coseKeyFromPublicKey(byte[] publicKey) {
        if (publicKey.length != 65 || publicKey[0] != 0x04) {
            throw new IllegalArgumentException("COSE key requires an uncompressed 65-byte P-256 point");
        }
        return cborMap(
                new byte[][]{cborInt(1), cborInt(2)},
                new byte[][]{cborInt(3), cborInt(COSE_ALG_ES256)},
                new byte[][]{cborInt(-1), cborInt(1)},
                new byte[][]{cborInt(-2), cborBytes(Arrays.copyOfRange(publicKey, 1, 33))},
                new byte[][]{cborInt(-3), cborBytes(Arrays.copyOfRange(publicKey, 33, 65))});
    }

    // ── authenticatorData ────────────────────────────────────────────────────

    /**
     * rpIdHash(32) || flags(1) || signCount(4 BE) || [aaguid(16) || credIdLen(2)
     * || credId || COSEKey]
     *
     * BE|BS are always set: a seed-derived credential genuinely is multi-device
     * and genuinely is backed up, by the user's 12/24 words.
     */
    public static byte[] buildAuthenticatorData(
            String rpId, boolean userVerified, boolean userPresent, int signCount,
            byte[] credentialId, byte[] publicKey, byte[] aaguid) {

        int flags = FLAG_BE | FLAG_BS;
        if (userPresent) flags |= FLAG_UP;
        if (userVerified) flags |= FLAG_UV;
        boolean attested = credentialId != null && publicKey != null;
        if (attested) flags |= FLAG_AT;

        byte[] counter = new byte[]{
                (byte) (signCount >>> 24), (byte) (signCount >>> 16),
                (byte) (signCount >>> 8), (byte) signCount};

        byte[] head = concat(rpIdHash(rpId), new byte[]{(byte) flags}, counter);
        if (!attested) return head;

        byte[] guid = aaguid == null ? AAGUID : aaguid;
        if (guid.length != 16) throw new IllegalArgumentException("aaguid must be 16 bytes");
        if (credentialId.length > 1023) throw new IllegalArgumentException("credentialId exceeds 1023 bytes");
        byte[] idLen = new byte[]{(byte) (credentialId.length >> 8), (byte) credentialId.length};
        return concat(head, guid, idLen, credentialId, coseKeyFromPublicKey(publicKey));
    }

    // ── Registration ─────────────────────────────────────────────────────────

    public static final class Attestation {
        public final byte[] attestationObject;
        public final byte[] authData;
        public final byte[] credentialId;
        public final byte[] publicKeyCose;
        public final byte[] publicKey;

        Attestation(byte[] attestationObject, byte[] authData, byte[] credentialId,
                    byte[] publicKeyCose, byte[] publicKey) {
            this.attestationObject = attestationObject;
            this.authData = authData;
            this.credentialId = credentialId;
            this.publicKeyCose = publicKeyCose;
            this.publicKey = publicKey;
        }
    }

    /**
     * fmt "none" — we make no claim about hardware because there is none to
     * claim: the "authenticator" is the user's seed. Emission order is CTAP2
     * canonical ("fmt"(3) < "attStmt"(7) < "authData"(8)).
     */
    public static Attestation buildAttestationObject(byte[] root, String rpId, byte[] nonce,
                                                     boolean userVerified, byte[] aaguid) {
        CredentialKey key = deriveCredentialKey(root, rpId, nonce);
        byte[] credentialId = makeCredentialId(root, rpId, nonce);
        byte[] authData = buildAuthenticatorData(
                rpId, userVerified, true, SIGN_COUNT, credentialId, key.publicKey, aaguid);

        byte[] attestationObject = cborMap(
                new byte[][]{cborText("fmt"), cborText("none")},
                new byte[][]{cborText("attStmt"), cborMap()},
                new byte[][]{cborText("authData"), cborBytes(authData)});

        return new Attestation(attestationObject, authData, credentialId,
                coseKeyFromPublicKey(key.publicKey), key.publicKey);
    }

    // ── Assertion ────────────────────────────────────────────────────────────

    public static final class Assertion {
        public final byte[] authenticatorData;
        public final byte[] signature;   // ASN.1 DER, low-S

        Assertion(byte[] authenticatorData, byte[] signature) {
            this.authenticatorData = authenticatorData;
            this.signature = signature;
        }
    }

    /**
     * ES256 over SHA-256(authenticatorData || clientDataHash).
     *
     * RFC 6979 deterministic k + low-S normalisation, matching TypeScript's
     * @noble default plus explicit normalisation. Determinism is not a nicety
     * here: it lets the shared vectors pin the SIGNATURE BYTES, so an encoding
     * divergence between the two implementations fails a test instead of
     * shipping. It also removes any dependence on this background service having
     * a healthy RNG.
     */
    public static Assertion buildAssertion(byte[] root, String rpId, byte[] credentialId,
                                           byte[] clientDataHash, boolean userVerified) {
        if (clientDataHash == null || clientDataHash.length != 32) {
            throw new IllegalArgumentException("clientDataHash must be 32 bytes");
        }
        byte[] nonce = parseCredentialId(root, rpId, credentialId);   // throws on tamper
        CredentialKey key = deriveCredentialKey(root, rpId, nonce);

        byte[] authenticatorData = buildAuthenticatorData(
                rpId, userVerified, true, SIGN_COUNT, null, null, null);

        byte[] digest = sha256(concat(authenticatorData, clientDataHash));

        ECDSASigner signer = new ECDSASigner(new HMacDSAKCalculator(new SHA256Digest()));
        signer.init(true, new ECPrivateKeyParameters(new BigInteger(1, key.privateKey), P256_DOMAIN));
        BigInteger[] rs = signer.generateSignature(digest);
        BigInteger r = rs[0];
        BigInteger s = rs[1];

        BigInteger halfN = P256.getN().shiftRight(1);
        if (s.compareTo(halfN) > 0) s = P256.getN().subtract(s);

        return new Assertion(authenticatorData, derEncode(r, s));
    }

    private static byte[] derEncode(BigInteger r, BigInteger s) {
        try {
            ASN1EncodableVector v = new ASN1EncodableVector();
            v.add(new ASN1Integer(r));
            v.add(new ASN1Integer(s));
            return new DERSequence(v).getEncoded("DER");
        } catch (IOException e) {
            throw new IllegalStateException("DER encoding failed", e);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    public static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    public static byte[] concat(byte[]... parts) {
        int total = 0;
        for (byte[] p : parts) total += p.length;
        byte[] out = new byte[total];
        int at = 0;
        for (byte[] p : parts) {
            System.arraycopy(p, 0, out, at, p.length);
            at += p.length;
        }
        return out;
    }

    private static byte[] to32(BigInteger d) {
        byte[] raw = d.toByteArray();
        byte[] out = new byte[32];
        if (raw.length > 32) {
            System.arraycopy(raw, raw.length - 32, out, 0, 32);   // strip sign byte
        } else {
            System.arraycopy(raw, 0, out, 32 - raw.length, raw.length);
        }
        return out;
    }

    private static void requireRoot(byte[] root) {
        if (root == null || root.length != 32) {
            throw new IllegalArgumentException("WebAuthn root must be 32 bytes");
        }
    }

    private static void write(ByteArrayOutputStream out, byte[] b) {
        out.write(b, 0, b.length);
    }

    public static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    public static byte[] fromHex(String hex) {
        int len = hex.length();
        if (len % 2 != 0) throw new IllegalArgumentException("hex string must have an even length");
        byte[] out = new byte[len / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    /**
     * base64url, no padding — the WebAuthn JSON wire format.
     *
     * java.util.Base64, not android.util.Base64: this class must run unchanged
     * in the JVM parity suite, and the Android one is a stub there that returns
     * null. Available from API 26, which is our minSdk.
     */
    public static String base64Url(byte[] bytes) {
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public static byte[] fromBase64Url(String s) {
        return java.util.Base64.getUrlDecoder().decode(s);
    }
}
