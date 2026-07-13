/**
 * qr-scan.ts — Camera QR scanning via ML Kit (Android)
 *
 * Uses the one-shot ML Kit scan UI (Google code scanner) — no in-WebView camera
 * preview to manage. On devices without Google Play Services the scan call
 * fails; callers fall back to paste (WalletConnectPage keeps its paste-URI box,
 * SendModal its address field), so a null return is always safe.
 */

import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning'

/** Scan a single QR code. Resolves the decoded text, or null on cancel/denied/unsupported. */
export async function scanQr(): Promise<string | null> {
  try {
    const perm = await BarcodeScanner.requestPermissions()
    if (perm.camera !== 'granted' && perm.camera !== 'limited') return null
    const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] })
    return barcodes[0]?.rawValue ?? null
  } catch {
    // User cancelled, or the Google code-scanner module isn't available.
    return null
  }
}
