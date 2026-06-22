export const PUBLIC_ASSET_BASE = `${import.meta.env.BASE_URL || '/'}assets/`;

export function publicAssetUrl(path) {
  return `${PUBLIC_ASSET_BASE}${path.replace(/^\/+/, '')}`;
}
