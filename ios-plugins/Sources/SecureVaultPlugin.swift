import Foundation
import Capacitor
import LocalAuthentication
import Security

/**
 * SecureVault — hardware-enforced biometric storage for the wallet's key material.
 *
 * WHY THIS EXISTS (do not replace it with @capgo/capacitor-native-biometric):
 *
 * That plugin stores credentials as a plain kSecClassInternetPassword with no
 * kSecAttrAccessControl and no kSecAttrAccessible restriction, and its
 * verifyIdentity() is a SEPARATE call. So the biometric check is
 * *app-enforced*: the keychain will hand the key material to anything that
 * asks, and only the app's own control flow says a Face ID scan happened
 * first. Anyone who can read the keychain off the device — a jailbreak, an
 * unencrypted backup, a debugger on a dev-signed build — gets the material
 * without ever facing a biometric prompt. src/capacitor/biometric.ts documents
 * this as a known gap on Android, where the fix is awkward.
 *
 * On iOS the fix is cheap and complete, so we take it:
 *
 *   kSecAttrAccessControl = .biometryCurrentSet
 *     The Secure Enclave refuses to release the item without a LIVE biometric
 *     match. Not a flag the app checks — a decryption the hardware performs.
 *     `.biometryCurrentSet` (not `.biometryAny`) additionally invalidates the
 *     item if a face or fingerprint is later enrolled, so an attacker who
 *     learns the passcode cannot add their own biometric and unlock the vault.
 *
 *   kSecAttrAccessible = .whenPasscodeSetThisDeviceOnly
 *     Never leaves the device, never rides an iCloud or iTunes backup, and
 *     ceases to exist if the user removes their passcode.
 *
 * The wallet password remains the recovery path, exactly as on every other
 * platform: this stores only a wrapping key, never the mnemonic itself, and
 * removing it never touches 'wallet.enc'.
 */
@objc(SecureVaultPlugin)
public class SecureVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureVaultPlugin"
    public let jsName = "SecureVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "store", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retrieve", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasItem", returnType: CAPPluginReturnPromise),
    ]

    private static let service = "info.chainlens.magicmoney.vault"

    // ── Availability ────────────────────────────────────────────────────────

    @objc func isAvailable(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        // .deviceOwnerAuthenticationWithBiometrics, NOT ...Authentication:
        // the latter silently accepts a passcode, which is not what the user
        // is being promised when they enable "biometric unlock".
        let ok = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)

        var biometry = "none"
        switch context.biometryType {
        case .faceID: biometry = "faceId"
        case .touchID: biometry = "touchId"
        case .opticID: biometry = "opticId"
        default: biometry = "none"
        }

        call.resolve([
            "isAvailable": ok,
            "biometry": biometry,
            "reason": error?.localizedDescription ?? "",
        ])
    }

    // ── Store ───────────────────────────────────────────────────────────────

    @objc func store(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty,
              let value = call.getString("value"), !value.isEmpty,
              let data = value.data(using: .utf8) else {
            call.reject("store requires non-empty key and value")
            return
        }

        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            .biometryCurrentSet,
            &accessError
        ) else {
            let message = (accessError?.takeRetainedValue() as Error?)?.localizedDescription
                ?? "Could not create a Secure Enclave access policy"
            call.reject(message)
            return
        }

        // Writing is not a read of the protected item, so it must NOT prompt.
        // Without this the user would face two biometric prompts during enroll.
        let context = LAContext()
        context.interactionNotAllowed = true

        // Replace rather than update: SecItemUpdate on an access-control-bound
        // item would require authentication to read the existing one first.
        SecItemDelete(baseQuery(key: key) as CFDictionary)

        var attributes = baseQuery(key: key)
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessControl as String] = access
        attributes[kSecUseAuthenticationContext as String] = context

        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else {
            call.reject("Could not save to the Secure Enclave (\(status))")
            return
        }
        call.resolve()
    }

    // ── Retrieve (this is the call that triggers the hardware prompt) ────────

    @objc func retrieve(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("retrieve requires a key")
            return
        }
        let reason = call.getString("reason") ?? "Unlock your wallet"

        let context = LAContext()
        context.localizedReason = reason
        // No "Enter Password" escape hatch on the biometric sheet: the app's
        // own password screen is the recovery path, and it unlocks the real
        // vault rather than this wrapping key.
        context.localizedFallbackTitle = ""

        var query = baseQuery(key: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context
        query[kSecUseOperationPrompt as String] = reason

        // SecItemCopyMatching blocks on the biometric sheet — never on main.
        DispatchQueue.global(qos: .userInitiated).async {
            var item: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &item)

            DispatchQueue.main.async {
                switch status {
                case errSecSuccess:
                    guard let data = item as? Data,
                          let value = String(data: data, encoding: .utf8) else {
                        call.reject("Stored value was unreadable")
                        return
                    }
                    call.resolve(["value": value])

                case errSecUserCanceled:
                    call.reject("cancelled", "cancelled")

                case errSecItemNotFound:
                    // Also what a .biometryCurrentSet invalidation looks like:
                    // enrolling a new face/finger destroys the item by design.
                    call.reject("Biometric unlock is not set up", "not-found")

                case errSecAuthFailed:
                    call.reject("Biometric authentication failed", "auth-failed")

                default:
                    call.reject("Could not read from the Secure Enclave (\(status))")
                }
            }
        }
    }

    // ── Remove / probe ──────────────────────────────────────────────────────

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("remove requires a key")
            return
        }
        let status = SecItemDelete(baseQuery(key: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("Could not remove the stored key (\(status))")
            return
        }
        call.resolve()
    }

    /**
     * Existence probe that must NOT prompt — the UI calls this on every launch
     * to decide whether to offer biometric unlock at all.
     * kSecUseAuthenticationUIFail makes a protected item report
     * errSecInteractionNotAllowed instead of showing a sheet, which is itself
     * proof the item exists.
     */
    @objc func hasItem(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("hasItem requires a key")
            return
        }
        var query = baseQuery(key: key)
        query[kSecReturnData as String] = false
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail

        let status = SecItemCopyMatching(query as CFDictionary, nil)
        call.resolve(["exists": status == errSecSuccess || status == errSecInteractionNotAllowed])
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private func baseQuery(key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: key,
        ]
    }
}
