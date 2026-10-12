export interface UserProfile {
  id: string;
  email: string | null;
  name: string | null;
  username: string | null;
  plan: string | null;
}

export interface Credits {
  total: number | null;
  currencyCode: string | null;
  upgradeUrl: string | null;
}

export interface Folder {
  id: string;
  name: string;
  icon: string | null;
  parentId: string | null;
}

export interface PromptSummary {
  id: string;
  name: string;
  phrasePreview: string | null;
  folder: { id: string; name: string } | null;
  updatedAt: string | null;
  accessRole: string | null;
}

export interface PromptPage {
  page: number;
  pageSize: number;
  total: number | null;
  prompts: PromptSummary[];
}

export interface PromptAsset {
  id: string;
  kind: string | null;
  origin: string | null;
  name: string | null;
  url: string | null;
}

export interface PromptDetail {
  id: string;
  name: string;
  phrase: string;
  folder: { id: string; name: string } | null;
  accessRole: string | null;
  assets: PromptAsset[];
}

export interface SavedPrompt {
  id: string;
  name: string;
  folderId: string | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  credits: number | null;
  supportsRefs: boolean;
  inPicker: boolean;
}

export interface ModelCatalog {
  defaultModelId: string | null;
  models: ModelInfo[];
}

export interface ListQuery {
  folderId?: string;
  page?: number;
  pageSize?: number;
}

export interface Studio {
  whoami(): Promise<UserProfile>;
  credits(): Promise<Credits>;
  listFolders(): Promise<Folder[]>;
  listPrompts(query: ListQuery): Promise<PromptPage>;
  searchPrompts(query: string, options: ListQuery): Promise<PromptPage>;
  getPrompt(id: string): Promise<PromptDetail>;
  createPrompt(input: { phrase: string; name?: string; folderId?: string }): Promise<SavedPrompt>;
  listModels(): Promise<ModelCatalog>;
  generateImage(input: { promptId: string; modelId?: string }): Promise<unknown>;
  pollGeneration(jobId: string, waitMs: number): Promise<unknown>;
  close(): Promise<void>;
}
