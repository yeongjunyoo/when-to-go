/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROXY_BASE?: string;
  readonly VITE_ENABLE_MAP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
