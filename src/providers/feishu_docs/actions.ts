import type { ActionDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const requiredScopes = ["docs:permission.member:create"];

export const feishuDocsActions: ActionDefinition[] = [
  defineProviderAction("feishu_docs", {
    name: "add_permission_member",
    description: "Add one exact user as an editable member of one Feishu Base.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.requiredObject("Exact Base member permission input.", {
      token: s.nonEmptyString("The exact Feishu Base app_token."),
      memberType: s.stringEnum("The member identifier type.", ["openid", "unionid"]),
      memberId: s.nonEmptyString("The exact user open_id or union_id."),
      permission: s.stringEnum("The permission to grant.", ["edit"]),
    }),
    outputSchema: s.looseRequiredObject("Feishu permission member response.", {
      code: s.integer("Feishu result code."),
      msg: s.string("Feishu result message."),
      data: s.looseObject({}, { description: "Feishu member response data." }),
    }),
  }),
];
