import type { CredentialValidators, ExecutionContext, ProviderExecutors } from "../../core/types.ts";

import { optionalString, requiredString } from "../../core/cast.ts";
import { ProviderRequestError, defineProviderExecutors, requireCustomCredential } from "../provider-runtime.ts";

const baseUrl = "https://open.feishu.cn/open-apis";

type Context = { appId: string; appSecret: string; fetcher: typeof fetch; signal?: AbortSignal };

async function tenantToken(context: Context): Promise<string> {
  const response = await context.fetcher(`${baseUrl}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: context.appId, app_secret: context.appSecret }),
    signal: context.signal,
  });
  const payload = (await response.json()) as { code?: unknown; msg?: unknown; tenant_access_token?: unknown };
  if (!response.ok || payload.code !== 0 || typeof payload.tenant_access_token !== "string") {
    throw new ProviderRequestError(response.status >= 500 ? 502 : 401, "Unable to obtain Feishu tenant access token");
  }
  return payload.tenant_access_token;
}

export const feishuDocsActionHandlers = {
  async add_permission_member(input: Record<string, unknown>, context: Context): Promise<unknown> {
    const token = requiredString(input.token, "token");
    const memberType = requiredString(input.memberType, "memberType");
    const memberId = requiredString(input.memberId, "memberId");
    const permission = requiredString(input.permission, "permission");
    if (!(["openid", "unionid"] as string[]).includes(memberType) || permission !== "edit") {
      throw new ProviderRequestError(400, "memberType must be openid or unionid and permission must be edit");
    }
    const accessToken = await tenantToken(context);
    const response = await context.fetcher(
      `${baseUrl}/drive/v1/permissions/${encodeURIComponent(token)}/members?type=bitable`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ member_type: memberType, member_id: memberId, perm: permission, type: "user" }),
        signal: context.signal,
      },
    );
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok || payload.code !== 0) {
      const message = optionalString(payload.msg) ?? "Feishu permission request failed";
      throw new ProviderRequestError(
        response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status,
        message,
        payload,
      );
    }
    return payload;
  },
};

export const executors: ProviderExecutors = defineProviderExecutors<Context>({
  service: "feishu_docs",
  handlers: feishuDocsActionHandlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch): Promise<Context> {
    const credential = await requireCustomCredential(context, "feishu_bitable");
    return {
      appId: requiredString(credential.values.appId, "appId"),
      appSecret: requiredString(credential.values.appSecret, "appSecret"),
      fetcher,
      signal: context.signal,
    };
  },
  fallbackMessage: "Feishu Docs permission request failed",
});

export const credentialValidators: CredentialValidators = {};
