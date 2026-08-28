/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_PROXY_BASE?: string;
  readonly VITE_ENABLE_MAP?: string;
  readonly VITE_LOCAL_STORAGE_APPROVED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
