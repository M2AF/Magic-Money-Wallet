/**
 * hello-bridge.ts — Windows Hello (strong, TPM-backed) bridge for vault unlock.
 *
 * Path B from the passkey investigation: WebAuthn on Windows Hello can't hold a
 * key here (no PRF/largeBlob), so we use the native Windows Hello key API,
 * `Windows.Security.Credentials.KeyCredentialManager`. It creates an asymmetric
 * key stored in the TPM and released only after a Hello check (face/finger/PIN).
 *
 * We can't decrypt with that key (the API only signs), so the secret we wrap the
 * vault with is derived from a SIGNATURE over a fixed challenge:
 *     wrapKey = HKDF( RequestSignAsync(FIXED_CHALLENGE) )
 * RSASSA-PKCS1-v1.5 (what KeyCredential uses) is deterministic, so the same
 * challenge yields the same signature every time — a stable key that only exists
 * after a successful Hello ceremony and never leaves the TPM. secure-store does
 * the HKDF + AES-GCM; this module only obtains the raw signature.
 *
 * Bridge mechanism: we shell out to Windows PowerShell 5.1 (always present on
 * Windows) which projects the WinRT API. No native module / build toolchain. The
 * script returns ONLY the signature bytes; all key material stays in this process.
 *
 * Windows-only. Callers gate on process.platform === 'win32'.
 */

import { spawn } from 'child_process'

export interface HelloResult {
  ok: boolean
  /** KeyCredential* status string, e.g. 'Success', 'UserCanceled', 'NotFound'. */
  status?: string
  /** base64 signature bytes (enroll/sign) — the secret wrapKey is derived from this. */
  signatureB64?: string
  /** 'supported' command: whether Windows Hello is set up on this machine. */
  supported?: boolean
  error?: string
}

export type HelloCommand = 'enroll' | 'sign' | 'delete' | 'supported'

const PS_EXE = 'powershell.exe'

// Stable identifiers shared by enroll + unlock. The challenge MUST be constant so
// the RSA signature (and thus the derived wrap key) is identical every time.
export const HELLO_KEY_NAME = 'MagicMoneyWalletVault'
export const HELLO_CHALLENGE_B64 = Buffer.from('magicmoney-hello-vault-challenge-v1', 'utf8').toString('base64')

/** True only on Windows; KeyCredentialManager is a Windows API. */
export function helloPlatformOk(): boolean {
  return process.platform === 'win32'
}

/** Is Windows Hello set up (a PIN/biometric enrolled) on this machine? Non-interactive. */
export async function helloSupported(): Promise<boolean> {
  if (!helloPlatformOk()) return false
  const r = await runHello('supported', HELLO_KEY_NAME)
  return r.ok && r.supported === true
}

/** Single-quote-escape a value for safe interpolation into the PS script. */
function psStr(v: string): string {
  return "'" + v.replace(/'/g, "''") + "'"
}

/**
 * Build the PowerShell that drives KeyCredentialManager for one command. Values
 * are app-controlled (constant key name + our own base64 challenge), so there is
 * no untrusted interpolation, but they're still quote-escaped defensively.
 */
function buildScript(command: HelloCommand, keyName: string, challengeB64: string): string {
  return `
$ErrorActionPreference = 'Stop'
$Command = ${psStr(command)}
$KeyName = ${psStr(keyName)}
$ChallengeB64 = ${psStr(challengeB64)}
function Out-Json($o) { Write-Output ($o | ConvertTo-Json -Compress) }
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
  $asTaskAct = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
  function AwaitOp($op, $t) { $task = $asTaskOp.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
  function AwaitAct($op) { $task = $asTaskAct.Invoke($null, @($op)); $task.Wait(-1) | Out-Null }

  [void][Windows.Security.Credentials.KeyCredentialManager, Windows.Security.Credentials, ContentType = WindowsRuntime]
  [void][Windows.Storage.Streams.IBuffer, Windows.Storage, ContentType = WindowsRuntime]
  # INPUT byte[] -> IBuffer: AsBuffer returns a proper .NET-projected IBuffer.
  $BufExt = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]
  # OUTPUT IBuffer -> byte[]: buffers RETURNED from WinRT come back as bare
  # __ComObjects that PS5.1 cannot marshal to any IBuffer-typed method, and reading
  # .Length off the __ComObject is wrong. Read bytes via the low-level COM interfaces
  # instead: IBuffer (real IID read at runtime) for Length, IBufferByteAccess for the
  # data pointer. Self-contained C#; needs no Windows SDK.
  $iid = ([Windows.Storage.Streams.IBuffer].GUID).ToString()
  if (-not ('HelloBuf.BufHelper' -as [type])) {
    $cs = @"
using System;
using System.Runtime.InteropServices;
namespace HelloBuf {
  [ComImport, Guid("$iid"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
  public interface IBufferRT { uint Capacity { [return: MarshalAs(UnmanagedType.U4)] get; } uint Length { [return: MarshalAs(UnmanagedType.U4)] get; set; } }
  [ComImport, Guid("905A0FEF-BC53-11DF-8C49-001E4FC686DA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IBufferByteAccess { IntPtr Buffer(); }
  public static class BufHelper {
    public static byte[] ToBytes(object buf) {
      int len = (int)((IBufferRT)buf).Length;
      IntPtr ptr = ((IBufferByteAccess)buf).Buffer();
      byte[] b = new byte[len];
      Marshal.Copy(ptr, b, 0, len);
      return b;
    }
  }
}
"@
    Add-Type -TypeDefinition $cs -Language CSharp
  }
  $KCM = [Windows.Security.Credentials.KeyCredentialManager]
  $SUCCESS = [Windows.Security.Credentials.KeyCredentialStatus]::Success

  if ($Command -eq 'supported') {
    $sup = AwaitOp ($KCM::IsSupportedAsync()) ([bool])
    Out-Json @{ ok = $true; status = 'Success'; supported = [bool]$sup }
    return
  }

  if ($Command -eq 'delete') {
    AwaitAct ($KCM::DeleteAsync($KeyName))
    Out-Json @{ ok = $true; status = 'Success' }
    return
  }

  if ($Command -eq 'enroll') {
    $opt = [Windows.Security.Credentials.KeyCredentialCreationOption]::ReplaceExisting
    $retrieval = AwaitOp ($KCM::RequestCreateAsync($KeyName, $opt)) ([Windows.Security.Credentials.KeyCredentialRetrievalResult])
  } else {
    $retrieval = AwaitOp ($KCM::OpenAsync($KeyName)) ([Windows.Security.Credentials.KeyCredentialRetrievalResult])
  }
  if ($retrieval.Status -ne $SUCCESS) { Out-Json @{ ok = $false; status = $retrieval.Status.ToString() }; return }

  $cred = $retrieval.Credential
  $challenge = [Convert]::FromBase64String($ChallengeB64)
  $ibuf = $BufExt::AsBuffer($challenge)
  $sign = AwaitOp ($cred.RequestSignAsync($ibuf)) ([Windows.Security.Credentials.KeyCredentialOperationResult])
  if ($sign.Status -ne $SUCCESS) { Out-Json @{ ok = $false; status = $sign.Status.ToString() }; return }

  $outBytes = [HelloBuf.BufHelper]::ToBytes($sign.Result)
  Out-Json @{ ok = $true; status = 'Success'; signatureB64 = [Convert]::ToBase64String($outBytes) }
} catch {
  Out-Json @{ ok = $false; error = $_.Exception.Message }
}
`.trim()
}

/**
 * Run one Hello command. `enroll`/`sign` trigger the Hello consent UI and return
 * a signature; `delete` removes the key. Resolves with a parsed result (never
 * rejects — failures come back as { ok:false }).
 */
export function runHello(command: HelloCommand, keyName: string, challengeB64 = ''): Promise<HelloResult> {
  if (!helloPlatformOk()) return Promise.resolve({ ok: false, error: 'Windows Hello is only available on Windows' })

  const script = buildScript(command, keyName, challengeB64)
  // -EncodedCommand (UTF-16LE base64) avoids all quoting/escaping issues across
  // the process boundary. -Sta because some WinRT UI paths require a single-
  // threaded apartment for the consent dialog.
  const encoded = Buffer.from(script, 'utf16le').toString('base64')

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(PS_EXE, ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true })
    } catch (e) {
      resolve({ ok: false, error: `Failed to launch Hello bridge: ${String(e)}` })
      return
    }
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', e => resolve({ ok: false, error: `Hello bridge error: ${String(e)}` }))
    child.on('close', () => {
      const line = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop()
      if (!line) { resolve({ ok: false, error: stderr.trim() || 'No output from Hello bridge' }); return }
      try {
        resolve(JSON.parse(line) as HelloResult)
      } catch {
        resolve({ ok: false, error: `Unparseable Hello output: ${line.slice(0, 200)}` })
      }
    })
  })
}
