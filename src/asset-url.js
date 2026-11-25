// Vite supplies the installation path for project sites. Node-based asset tests use the root.
export function assetUrl(path) {
  return (import.meta.env?.BASE_URL ?? '/') + path;
}
