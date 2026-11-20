/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_QNS_ADDRESS?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
