// NFT identity is presentation metadata, not a live ownership attestation.
export function validateAvatar(body) {
  if (body.avatar_url === undefined) return body.avatar_nft_key === undefined ? { updates: {} } : { error: 'Choose a profile picture with the NFT' };
  if (typeof body.avatar_url !== 'string') return { error: 'Profile picture must be an image URL' };
  const url = body.avatar_url.trim();
  if (url && !/^https:\/\//i.test(url) && !/^data:image\/(?:jpeg|png|gif|webp);base64,/i.test(url)) return { error: 'Profile picture must use HTTPS or a supported image file' };
  if (url.length > 2.8 * 1024 * 1024) return { error: 'Profile picture is too large', status: 413 };
  const key = body.avatar_nft_key ?? null;
  if (key !== null && (typeof key !== 'string' || key.length > 400 || !/^[a-z0-9_-]+:n:[^\s]+$/i.test(key) || !url || !/^https:\/\//i.test(url))) return { error: 'Choose an NFT from your collection' };
  return { updates: { avatar_url: url || null, avatar_nft_key: key } };
}

