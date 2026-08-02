Pod::Spec.new do |s|
  s.name             = 'MagicMoneyPlugins'
  s.version          = '0.1.0'
  s.summary          = "MagicMoney's custom Capacitor plugins (iOS)"
  s.description      = <<-DESC
    Swift counterparts of the custom Java plugins in android/app/src/main/java/
    info/chainlens/magicmoney: AppInfo (secure screen), Downloader (NFT media),
    and — from Phase 2 — DappBrowser.
  DESC
  s.homepage         = 'https://github.com/M2AF/Magic-Money-Wallet'
  s.license          = { :type => 'Proprietary' }
  s.author           = { 'ChainLens' => 'guildfordking@gmail.com' }
  s.source           = { :path => '.' }

  # THE POINT OF THIS POD: a glob, not a file list.
  #
  # This project is developed on Windows and built only on GitHub Actions
  # macOS runners — nobody on the team has Xcode. Adding a Swift file to an
  # Xcode target normally means hand-editing project.pbxproj (generated UUIDs,
  # build phases, file references), which is miserable and error-prone to do
  # blind from another OS. CocoaPods re-resolves this glob on every
  # `pod install`, so dropping a .swift file into Sources/ is the entire
  # process — the pbxproj is never touched by hand.
  s.source_files     = 'Sources/**/*.{swift,h,m}'

  # Must match DEPLOYMENT_TARGET in scripts/patch-ios-native.js, which sets the
  # same value in ios/App/Podfile and project.pbxproj (CocoaPods resolves
  # dependencies against the Podfile's platform, so a mismatch here surfaces as
  # a confusing version-resolution failure rather than a clear error).
  #
  # Not Capacitor's 14.0 floor, for two reasons: GoogleMLKit/BarcodeScanning
  # 7.0.0 (the QR scanner) requires 15.5+, and Phase 3 routes the dApp browser
  # through Tor via WKWebView proxyConfigurations, which is iOS 17+.
  s.ios.deployment_target = '17.0'
  s.swift_version    = '5.9'

  # Capacitor discovers plugins at RUNTIME by scanning the Objective-C class
  # list for CAPBridgedPlugin conformers. Nothing in the app references these
  # classes at compile time, so without -ObjC the linker treats them as dead
  # code and never pulls them out of this static library — the app then builds
  # and launches perfectly but every registerPlugin() call resolves to a stub
  # that rejects with "not implemented". Setting it on the USER target (the
  # app) is what matters; setting it only on the pod target would not help.
  s.user_target_xcconfig = { 'OTHER_LDFLAGS' => '-ObjC' }

  s.dependency 'Capacitor'
end
