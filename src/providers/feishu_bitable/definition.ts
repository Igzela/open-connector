import type { ProviderDefinition } from "../../core/types.ts";

import { feishuBitableActions } from "./actions.ts";

const service = "feishu_bitable";

/** Feishu Base (Bitable) provider using a tenant custom-app credential. */
export const provider: ProviderDefinition = {
  service,
  displayName: "Feishu Bitable",
  description: "Read and write Feishu Base tables and records, and safely transfer Base attachments.",
  categories: ["Productivity", "Databases"],
  authTypes: ["custom_credential"],
  auth: [
    {
      type: "custom_credential",
      fields: [
        {
          key: "appId",
          label: "App ID",
          inputType: "text",
          required: true,
          secret: false,
          description:
            "The App ID of a published Feishu tenant custom app with bitable:app and wiki:wiki:readonly permissions.",
        },
        {
          key: "appSecret",
          label: "App Secret",
          inputType: "password",
          required: true,
          secret: true,
          description: "The App Secret of the Feishu tenant custom app. It remains inside OpenConnector.",
        },
      ],
    },
  ],
  homepageUrl: "https://open.feishu.cn",
  actions: feishuBitableActions,
};
