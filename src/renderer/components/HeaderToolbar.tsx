/**
 * HeaderToolbar.tsx — shared top-right toolbar for the main tabs.
 *
 * Renders the global wallet actions (sidebar toggle in the extension,
 * WalletConnect, Refresh, Profile, Settings) so Portfolio / Market / Swap / Apps
 * all share one consistent control cluster. WC / Profile / Settings are wired to
 * App-level state; Refresh is page-specific (omitted when a page has no refresh).
 */

interface Props {
  onWcOpen?: () => void
  wcActiveSessions?: number
  wcPending?: boolean
  onRefresh?: () => void
  refreshing?: boolean
  onProfile?: () => void
  onSettings?: () => void
}

const iconBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 'var(--radius-sm)',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
}

export function HeaderToolbar({
  onWcOpen, wcActiveSessions = 0, wcPending = false,
  onRefresh, refreshing = false, onProfile, onSettings,
}: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sidebarFn = (window as any).__EXT_SIDEBAR_FN__
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isSidePanel = (window as any).__SIDE_PANEL__

  return (
    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
      {/* Sidebar toggle — extension only */}
      {!!sidebarFn && (
        <button
          type="button"
          onClick={() => sidebarFn?.()}
          title={isSidePanel ? 'Back to popup' : 'Open in sidebar'}
          style={{ ...iconBtn, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          {isSidePanel ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="2" width="14" height="12" rx="2"/><line x1="5" y1="2" x2="5" y2="14"/>
              <polyline points="9,6 12,8 9,10"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="2" width="14" height="12" rx="2"/><line x1="6" y1="2" x2="6" y2="14"/>
              <polyline points="10,6 7,8 10,10"/>
            </svg>
          )}
        </button>
      )}

      {/* WalletConnect */}
      {onWcOpen && (
        <button
          type="button"
          onClick={onWcOpen}
          title="WalletConnect"
          style={{ ...iconBtn, background: wcActiveSessions > 0 ? 'var(--accent-dim)' : 'transparent', border: `1px solid ${wcActiveSessions > 0 ? 'var(--border-active)' : 'var(--border)'}`, color: wcActiveSessions > 0 ? 'var(--accent)' : 'var(--text-muted)', position: 'relative' }}
        >
          {wcPending && (
            <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%', background: '#f97316', boxShadow: '0 0 5px #f97316' }} />
          )}
          <svg width="22" height="15" viewBox="0 0 480 360" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round">
            <path d="M98.3,120.1 C182.3,37.4 325.7,37.4 409.7,120.1 L419.8,130 C430.1,140.2 430.1,156.5 419.8,166.7 L387.9,198.2 C382.7,203.3 374.1,203.3 369,198.2 L355.1,184.5 C299.1,129.4 180.9,129.4 124.9,184.5 L110,198.2 C104.9,203.3 96.3,203.3 91.1,198.2 L60.2,166.7 C49.9,156.5 49.9,140.2 60.2,130 Z"/>
            <path d="M183.5,204.7 C222.6,166 278.5,166 317.6,204.7 L323.9,210.9 C334.2,221.1 334.2,237.4 323.9,247.6 L292.6,278.5 C287.5,283.6 278.9,283.6 273.7,278.5 L263.4,268.4 C247.3,252.5 232.7,252.5 216.6,268.4 L206.3,278.5 C201.1,283.6 192.5,283.6 187.4,278.5 L156.1,247.6 C145.8,237.4 145.8,221.1 156.1,210.9 Z"/>
          </svg>
        </button>
      )}

      {/* Refresh */}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh"
          style={{ ...iconBtn, background: 'var(--accent-dim)', border: '1px solid var(--border)', color: 'var(--accent)', opacity: refreshing ? 0.5 : 1, transition: 'opacity var(--transition)' }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }}>
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      )}

      {/* Profile */}
      {onProfile && (
        <button
          type="button"
          onClick={onProfile}
          title="Profile"
          style={{ ...iconBtn, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
          </svg>
        </button>
      )}

      {/* Settings */}
      {onSettings && (
        <button
          type="button"
          onClick={onSettings}
          title="Settings"
          style={{ ...iconBtn, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      )}
    </div>
  )
}
