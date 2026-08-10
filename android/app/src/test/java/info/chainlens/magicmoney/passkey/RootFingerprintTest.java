package info.chainlens.magicmoney.passkey;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import org.junit.Test;

/**
 * The root fingerprint is a second cross-language contract, in the same spirit as
 * webauthn-vectors.json but deliberately separate from it — the v1 derivation
 * spec is frozen and this is not part of it.
 *
 * TypeScript writes discovery rows carrying this value
 * (`rootFingerprint` in passkey-system-provider.ts); Java decides at offer time
 * whether a row belongs to the root it holds. If the two ever disagree the
 * provider silently offers NOTHING, which is indistinguishable from "no passkeys
 * registered" — the same silent-failure family as the sandboxed-preload bug. So
 * both sides pin the same vector.
 */
public class RootFingerprintTest {

    /** Bytes 0x00..0x1f — the identical input the TypeScript test uses. */
    private static byte[] sampleRoot() {
        byte[] root = new byte[32];
        for (int i = 0; i < 32; i++) root[i] = (byte) i;
        return root;
    }

    @Test
    public void matchesTheSharedVector() throws Exception {
        assertEquals("630dcd2966c43366", PasskeyVault.rootFingerprint(sampleRoot()));
    }

    @Test
    public void isSixteenLowercaseHexCharacters() throws Exception {
        String fp = PasskeyVault.rootFingerprint(sampleRoot());
        assertEquals(16, fp.length());
        assertEquals(fp.toLowerCase(), fp);
    }

    /**
     * The whole point: two accounts of the SAME wallet have different roots, so a
     * row minted under one must not look signable under the other. This is the
     * failure that reached a real device — hasRoot() said yes, the MAC then said
     * no, and the user had already given a fingerprint.
     */
    @Test
    public void differsForADifferentRoot() throws Exception {
        byte[] other = sampleRoot();
        other[31] ^= 0x01;
        assertNotEquals(PasskeyVault.rootFingerprint(sampleRoot()),
                        PasskeyVault.rootFingerprint(other));
    }
}
