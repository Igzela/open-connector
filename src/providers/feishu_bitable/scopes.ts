/** Feishu permission required for Base (Bitable) metadata, record, and attachment access. */
export const feishuBitableScopes = {
  app: "bitable:app",
} as const;

export const feishuBitableProviderScopes: string[] = [feishuBitableScopes.app];
