export {};
declare global {
  interface Window {
    cowork: {
      getConfig(): Promise<{ serverUrl: string; hasToken: boolean } | null>;
      saveConfig(serverUrl: string, token: string): Promise<{ ok: boolean }>;
      clearConfig(): Promise<void>;
    };
  }
}
