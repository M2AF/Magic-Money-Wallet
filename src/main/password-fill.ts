/**
 * password-fill.ts — the saved-login fill script (pure; no Electron, no Node)
 *
 * Shared by the Electron browser (executeJavaScript into the tab's
 * WebContentsView) and Android (DappBrowser.fillCredentials → evaluateJavascript
 * on the active tab's WebView). Kept in one place because this is
 * security-sensitive: two hand-maintained copies would drift.
 *
 * Both callers MUST have already matched the credential against the host of the
 * page they are about to run this in — the script itself does no host checking,
 * it only types into the form it finds.
 *
 * Values are embedded with JSON.stringify, so a password containing quotes,
 * backslashes or newlines is data, never script.
 *
 * Returns 'ok' when a password field was filled, or 'no-form' when the page has
 * no visible password input.
 */

export function buildFillScript(username: string, password: string): string {
  return `(() => {
    const user = ${JSON.stringify(username)};
    const pass = ${JSON.stringify(password)};
    const visible = el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const setValue = (el, value) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      // React (and other controlled-input frameworks) track the last value on the
      // node itself; assigning .value directly is silently reverted on re-render.
      if (setter) setter.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const passwords = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible);
    if (passwords.length === 0) return 'no-form';
    const passField = passwords[0];
    setValue(passField, pass);
    if (user) {
      const form = passField.form || document;
      const candidates = Array.from(form.querySelectorAll('input')).filter(el =>
        visible(el) && ['text', 'email', 'tel', ''].includes((el.type || '').toLowerCase())
      );
      // The username box is the last plain field BEFORE the password box.
      const before = candidates.filter(el =>
        passField.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING
      );
      const target = before[before.length - 1] || candidates[0];
      if (target) setValue(target, user);
    }
    passField.focus();
    return 'ok';
  })()`
}
