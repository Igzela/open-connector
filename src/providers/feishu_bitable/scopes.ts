/** Feishu permissions required for Base access and Wiki-node resolution. */
export const feishuBitableScopes = {
  app: "bitable:app",
  wikiReadonly: "wiki:wiki:readonly",
} as const;

export const feishuBitableProviderScopes: string[] = [feishuBitableScopes.app, feishuBitableScopes.wikiReadonly];
