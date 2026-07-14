import type { ProviderDefinition } from "../../core/types.ts";

import { feishuDocsActions } from "./actions.ts";

export const provider: ProviderDefinition = {
  service: "feishu_docs",
  displayName: "Feishu Docs Permissions",
  description: "Manage exact Feishu Base document members using the configured Bitable app credential.",
  categories: ["Productivity", "Permissions"],
  authTypes: ["custom_credential"],
  auth: [],
  homepageUrl: "https://open.feishu.cn",
  actions: feishuDocsActions,
};
