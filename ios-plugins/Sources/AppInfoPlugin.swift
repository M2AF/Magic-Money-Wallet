import Foundation
import UIKit
import Capacitor

/**
 * AppInfo — iOS counterpart of AppInfoPlugin.java.
 *
 * Two methods, both with meaningfully different semantics from Android:
 *
 *  • getInstallSource() — Android distinguishes Play from sideload to decide
 *    whether the self-updater is legal. iOS has no sideload channel and no
 *    install-source API, so this always reports "appstore". The web layer
 *    doesn't actually depend on it (src/ios/update-check.ts already reports a
 *    store install), but the method is kept so the plugin surface matches.
 *
 *  • setSecureScreen(on:) — see SecureScreenGuard below. iOS has NO equivalent
 *    of FLAG_SECURE, so this is a best-effort composite rather than a
 *    guarantee, and it is documented as such in README.md.
 */
@objc(AppInfoPlugin)
public class AppInfoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppInfoPlugin"
    public let jsName = "AppInfo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getInstallSource", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSecureScreen", returnType: CAPPluginReturnPromise),
    ]

    private let guardian = SecureScreenGuard()

    @objc func getInstallSource(_ call: CAPPluginCall) {
        // Mirrors the Android shape { installer: String? }. TestFlight builds
        // report the same value — the distinction has no consequence here,
        // since neither channel permits self-updating.
        call.resolve(["installer": "appstore"])
    }

    @objc func setSecureScreen(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.resolve()
                return
            }
            if on {
                self.guardian.enable(window: self.bridge?.viewController?.view.window)
            } else {
                self.guardian.disable()
            }
            call.resolve()
        }
    }
}

/**
 * SecureScreenGuard — the closest iOS gets to Android's FLAG_SECURE.
 *
 * Android sets one window flag and the OS blocks screenshots, blocks screen
 * recording, and blanks the Recents preview. iOS offers no such flag, so this
 * composes three mechanisms with deliberately different confidence levels:
 *
 *   1. App-switcher blur (RELIABLE, documented). On willResignActive a cover
 *      view is added; on didBecomeActive it's removed. This is what stops the
 *      seed phrase appearing in the app-switcher card, and it is the layer
 *      that matters most in practice — an attacker with the unlocked phone in
 *      hand can reach the switcher, but not a live screenshot.
 *
 *   2. Screen-recording / mirroring cover (RELIABLE, documented). UIScreen's
 *      isCaptured + capturedDidChangeNotification are public API since iOS 11.
 *      When capture starts, the cover goes up and stays up. This genuinely
 *      defeats screen recording, AirPlay mirroring and QuickTime capture.
 *
 *   3. Still-screenshot suppression (BEST EFFORT, undocumented). Reparenting
 *      the window's layer under the private canvas layer of a secure
 *      UITextField makes the render server omit it from screenshots. It is a
 *      well-known trick, it is not API, and Apple can break it in any release.
 *      It is applied last and is fully reversible; if the layer hierarchy is
 *      not what's expected, it is skipped and (1) and (2) still hold.
 *
 * Because #3 can break silently, #1 and #2 are never made contingent on it.
 * README.md states the resulting guarantee honestly rather than implying
 * FLAG_SECURE parity.
 */
final class SecureScreenGuard {
    private var secureField: UITextField?
    private var coverView: UIView?
    private weak var window: UIWindow?
    private var observers: [NSObjectProtocol] = []
    private var active = false

    func enable(window: UIWindow?) {
        guard !active, let window = window else { return }
        self.window = window
        active = true

        installCaptureCover(on: window)
        observeAppState(window: window)
        applyScreenshotSuppression(to: window)
    }

    func disable() {
        guard active else { return }
        active = false

        removeScreenshotSuppression()
        for token in observers { NotificationCenter.default.removeObserver(token) }
        observers.removeAll()
        removeCover()
        window = nil
    }

    // ── 1 + 2: cover view ───────────────────────────────────────────────────

    private func observeAppState(window: UIWindow) {
        let center = NotificationCenter.default

        observers.append(center.addObserver(
            forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.showCover(on: window)
        })

        observers.append(center.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            // Don't lift the cover if a screen recording is still running —
            // becoming active again during capture must stay covered.
            guard UIScreen.main.isCaptured == false else { return }
            self?.removeCover()
        })

        observers.append(center.addObserver(
            forName: UIScreen.capturedDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            if UIScreen.main.isCaptured {
                self?.showCover(on: window)
            } else {
                self?.removeCover()
            }
        })
    }

    /// Cover immediately if a recording is already in progress when the seed
    /// screen opens — the notification only fires on transitions.
    private func installCaptureCover(on window: UIWindow) {
        if UIScreen.main.isCaptured { showCover(on: window) }
    }

    private func showCover(on window: UIWindow) {
        guard coverView == nil else { return }
        let cover = UIView(frame: window.bounds)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // Opaque, not a blur: a blur of a seed phrase can be partially
        // recoverable, and this is cheap and unambiguous.
        cover.backgroundColor = UIColor(red: 0.043, green: 0.043, blue: 0.059, alpha: 1.0)

        let label = UILabel()
        label.text = "MagicMoney"
        label.textColor = UIColor.white.withAlphaComponent(0.5)
        label.font = .systemFont(ofSize: 17, weight: .semibold)
        label.translatesAutoresizingMaskIntoConstraints = false
        cover.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
        ])

        window.addSubview(cover)
        coverView = cover
    }

    private func removeCover() {
        coverView?.removeFromSuperview()
        coverView = nil
    }

    // ── 3: screenshot suppression (undocumented, reversible) ────────────────

    private func applyScreenshotSuppression(to window: UIWindow) {
        let field = UITextField()
        field.isSecureTextEntry = true
        field.isUserInteractionEnabled = false

        // The secure canvas is a private sublayer the render server excludes
        // from captures. If UIKit ever stops creating it, bail out — the
        // reliable layers above are already in place.
        guard let canvas = field.layer.sublayers?.first else { return }
        guard let superlayer = window.layer.superlayer else { return }

        superlayer.addSublayer(field.layer)
        canvas.addSublayer(window.layer)
        secureField = field
    }

    private func removeScreenshotSuppression() {
        guard let field = secureField, let window = window else { return }
        // Put the window's layer back where UIKit expects it, then drop the
        // field's layer. Order matters: detaching the field first would leave
        // the window's layer orphaned and render a black screen.
        if let superlayer = field.layer.superlayer {
            superlayer.addSublayer(window.layer)
        }
        field.layer.removeFromSuperlayer()
        secureField = nil
    }
}
