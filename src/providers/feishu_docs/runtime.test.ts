import { describe, expect, it } from "vitest";
import { feishuDocsActionHandlers } from "./executors.ts";

function context(responses: Response[]) {
  const requests: Request[] = [];
  return {
    requests,
    fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      const response = responses.shift();
      if (!response) throw new Error("unexpected request");
      return response;
    },
    appId: "app",
    appSecret: "secret",
  };
}

describe("Feishu Docs permission provider", () => {
  it("adds an exact open_id member with edit permission through the official endpoint", async () => {
    const ctx = context([
      Response.json({ code: 0, tenant_access_token: "tenant" }),
      Response.json({ code: 0, msg: "success", data: { member_id: "ou_user" } }),
    ]);
    await expect(
      feishuDocsActionHandlers.add_permission_member(
        { token: "app_token", memberType: "openid", memberId: "ou_user", permission: "edit" },
        ctx,
      ),
    ).resolves.toMatchObject({ code: 0 });
    expect(ctx.requests[1]?.url).toBe(
      "https://open.feishu.cn/open-apis/drive/v1/permissions/app_token/members?type=bitable",
    );
    expect(JSON.parse(await ctx.requests[1]!.clone().text())).toEqual({
      member_type: "openid",
      member_id: "ou_user",
      perm: "edit",
      type: "user",
    });
  });

  it("supports union_id and rejects unsupported permission values", async () => {
    const ctx = context([]);
    await expect(
      feishuDocsActionHandlers.add_permission_member(
        { token: "app_token", memberType: "unionid", memberId: "on_user", permission: "view" },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("preserves permission and rate-limit failures", async () => {
    const forbidden = context([
      Response.json({ code: 0, tenant_access_token: "tenant" }),
      Response.json({ code: 403, msg: "forbidden" }, { status: 403 }),
    ]);
    await expect(
      feishuDocsActionHandlers.add_permission_member(
        { token: "app_token", memberType: "openid", memberId: "ou_user", permission: "edit" },
        forbidden,
      ),
    ).rejects.toMatchObject({ status: 403 });
    const limited = context([
      Response.json({ code: 0, tenant_access_token: "tenant" }),
      Response.json({ code: 429, msg: "limited" }, { status: 429 }),
    ]);
    await expect(
      feishuDocsActionHandlers.add_permission_member(
        { token: "app_token", memberType: "openid", memberId: "ou_user", permission: "edit" },
        limited,
      ),
    ).rejects.toMatchObject({ status: 429 });
  });
});
