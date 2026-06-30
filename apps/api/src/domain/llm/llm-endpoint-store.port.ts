/** A user-added custom endpoint, with the API key stored encrypted at rest. */
export type StoredLlmEndpoint = {
  id: string; // "custom:<uuid>"
  label: string;
  baseUrl: string;
  model: string;
  keyCipher: string;
  maxTokens: number | null;
  createdAt: Date;
};

export interface LlmEndpointStore {
  list(): Promise<StoredLlmEndpoint[]>;
  create(rec: StoredLlmEndpoint): Promise<StoredLlmEndpoint>;
  delete(id: string): Promise<void>;
}

export const LLM_ENDPOINT_STORE = Symbol("LlmEndpointStore");
