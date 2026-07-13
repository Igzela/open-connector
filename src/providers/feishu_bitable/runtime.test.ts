import type { FeishuBitableActionContext } from "./executors.ts";

import { describe, expect, it } from "vitest";
import { feishuBitableActions } from "./actions.ts";
import { feishuBitableActionHandlers } from "./executors.ts";

interface RecordedRequest {
  url: string;
  init?: RequestInit;
}

const expectedActionNames = [
  "list_tables",
  "list_fields",
  "get_record",
  "list_records",
  "create_record",
  "update_record",
  "batch_create_records",
  "download_attachment",
];

describe("Feishu Bitable provider", () => {
  it("registers the complete action catalog exactly once", () => {
    const names = feishuBitableActions.map((action) => action.name);
    expect(names).toEqual(expectedActionNames);
    expect(new Set(names).size).toBe(expectedActionNames.length);
  });

  it("authenticates and sends explicit list pagination", async () => {
    const requests: RecordedRequest[] = [];
    const context = createContext(requests, [
      tokenResponse(),
      Response.json({
        code: 0,
        msg: "success",
        data: { items: [{ table_id: "tbl1", name: "Inventory" }], has_more: true, page_token: "next" },
      }),
    ]);

    await expect(
      feishuBitableActionHandlers.list_tables({ appToken: "app token", pageSize: 50, pageToken: "previous" }, context),
    ).resolves.toMatchObject({
      code: 0,
      data: { items: [{ table_id: "tbl1", name: "Inventory" }], has_more: true, page_token: "next" },
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal");
    expect(requests[1]?.url).toBe(
      "https://open.feishu.cn/open-apis/bitable/v1/apps/app%20token/tables?page_size=50&page_token=previous",
    );
    expect(new Headers(requests[1]?.init?.headers).get("authorization")).toBe("Bearer tenant-token");
  });

  it("maps Feishu permission failures to a stable 403 error", async () => {
    const context = createContext(
      [],
      [tokenResponse(), Response.json({ code: 1254302, msg: "permission denied" }, { status: 403 })],
    );

    await expect(
      feishuBitableActionHandlers.list_fields({ appToken: "app1", tableId: "tbl1" }, context),
    ).rejects.toMatchObject({
      status: 403,
      message: "Feishu 1254302: permission denied",
    });
  });

  it("rejects invalid pagination before making a network request", async () => {
    const requests: RecordedRequest[] = [];
    const context = createContext(requests, []);

    await expect(
      Promise.resolve().then(() =>
        feishuBitableActionHandlers.list_tables({ appToken: "app1", pageSize: 501 }, context),
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "pageSize must be an integer from 1 to 500",
    });
    expect(requests).toEqual([]);
  });

  it("sends a batch write once and preserves per-record failures", async () => {
    const requests: RecordedRequest[] = [];
    const result = {
      code: 0,
      msg: "success",
      data: { records: [{ record_id: "rec1", fields: { Name: "A" } }], errors: [{ index: 1, code: 1254001 }] },
    };
    const context = createContext(requests, [tokenResponse(), Response.json(result)]);

    await expect(
      feishuBitableActionHandlers.batch_create_records(
        {
          appToken: "app1",
          tableId: "tbl1",
          records: [{ fields: { Name: "A" } }, { fields: { Name: "B" } }],
        },
        context,
      ),
    ).resolves.toEqual(result);

    expect(requests).toHaveLength(2);
    expect(requests[1]?.init?.method).toBe("POST");
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      records: [{ fields: { Name: "A" } }, { fields: { Name: "B" } }],
    });
  });

  it("rejects attachment types outside the allowlist before storing them", async () => {
    const requests: RecordedRequest[] = [];
    let stored = false;
    const context = createContext(requests, [
      tokenResponse(),
      new Response("plain text", { headers: { "content-type": "text/plain" } }),
    ]);
    context.transitFiles = {
      maxBytes: 10 * 1024 * 1024,
      async create() {
        stored = true;
        throw new Error("must not store disallowed content");
      },
      async read() {
        throw new Error("not used");
      },
      async delete() {
        return false;
      },
    };

    await expect(
      feishuBitableActionHandlers.download_attachment({ fileToken: "file1" }, context),
    ).rejects.toMatchObject({
      status: 415,
    });
    expect(stored).toBe(false);
  });

  it("normalizes aborted Feishu requests to 504", async () => {
    const context: FeishuBitableActionContext = {
      appId: `app-${crypto.randomUUID()}`,
      appSecret: "secret",
      fetcher: async () => {
        throw new DOMException("aborted", "AbortError");
      },
    };

    await expect(feishuBitableActionHandlers.list_tables({ appToken: "app1" }, context)).rejects.toMatchObject({
      status: 504,
    });
  });
});

function createContext(requests: RecordedRequest[], responses: Response[]): FeishuBitableActionContext {
  return {
    appId: `app-${crypto.randomUUID()}`,
    appSecret: "secret",
    fetcher: async (input, init): Promise<Response> => {
      requests.push({ url: input instanceof Request ? input.url : String(input), init });
      const response = responses.shift();
      if (!response) {
        throw new Error("Unexpected Feishu request");
      }
      return response;
    },
  };
}

function tokenResponse(): Response {
  return Response.json({ code: 0, msg: "success", tenant_access_token: "tenant-token", expire: 7200 });
}
