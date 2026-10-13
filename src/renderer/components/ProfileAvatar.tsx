import type { CSSProperties } from 'react'
import './ProfileAvatar.css'

export function ProfileAvatar({ profile, size = 56, alt = '' }: {profile: {avatar_url?: string | null; avatar_nft_key?: string | null; display_name?: string | null}, size?: number, alt?: string}) {
  const nft = !!(profile.avatar_url && profile.avatar_nft_key)
  return <span className={`cl-avatar ${nft ? 'cl-avatar--nft' : ''}`} style={{'--avatar-size':`${size}px`} as CSSProperties} data-avatar-kind={nft?'nft':'photo'}>
    <span className="cl-avatar-art">{profile.avatar_url ? <img src={profile.avatar_url} alt={alt} referrerPolicy="no-referrer" /> : <span>{(profile.display_name || '?').slice(0,2).toUpperCase()}</span>}</span>
  </span>
}
