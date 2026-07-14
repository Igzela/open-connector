import type { FeishuBitableActionContext } from "./executors.ts";

import { describe, expect, it } from "vitest";
import { feishuBitableActions } from "./actions.ts";
import { feishuBitableActionHandlers } from "./executors.ts";

interface RecordedRequest {
  url: string;
  init?: RequestInit;
}

const expectedActionNames = [
  "create_app",
  "create_table",
  "update_table",
  "delete_table",
  "create_field",
  "update_field",
  "delete_field",
  "resolve_wiki_node",
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

  it("declares the Wiki read scope on resolve_wiki_node", () => {
    const action = feishuBitableActions.find((candidate) => candidate.name === "resolve_wiki_node");
    expect(action?.requiredScopes).toContain("wiki:wiki:readonly");
    expect(action?.providerPermissions).toContain("wiki:wiki:readonly");
  });

  it("creates a Base and validates the required response metadata", async () => {
    const requests: RecordedRequest[] = [];
    const context = createContext(requests, [
      tokenResponse(),
      Response.json({
        code: 0,
        msg: "success",
        data: { app: { app_token: "app1", name: "Production", url: "https://example/base/app1" } },
      }),
    ]);

    await expect(feishuBitableActionHandlers.create_app({ name: "Production" }, context)).resolves.toMatchObject({
      data: { app: { app_token: "app1", name: "Production" } },
    });
    expect(requests[1]?.url).toBe("https://open.feishu.cn/open-apis/bitable/v1/apps");
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ name: "Production" });
  });

  it("creates, updates, and deletes tables and fields through exact official paths", async () => {
    const tableContextRequests: RecordedRequest[] = [];
    const tableContext = createContext(tableContextRequests, [
      tokenResponse(),
      Response.json({
        code: 0,
        msg: "success",
        data: { table_id: "tbl1", default_view_id: "vew1", field_id_list: ["fld1"] },
      }),
    ]);
    await expect(
      feishuBitableActionHandlers.create_table(
        { appToken: "app1", table: { name: "Inventory", fields: [{ fieldName: "物料ID", type: 1 }] } },
        tableContext,
      ),
    ).resolves.toMatchObject({ data: { table_id: "tbl1" } });
    expect(tableContextRequests[1]?.url).toContain("/bitable/v1/apps/app1/tables");

    const fieldRequests: RecordedRequest[] = [];
    const fieldContext = createContext(fieldRequests, [
      tokenResponse(),
      Response.json({ code: 0, msg: "success", data: { field: { field_id: "fld1", field_name: "状态", type: 3 } } }),
    ]);
    await expect(
      feishuBitableActionHandlers.create_field(
        {
          appToken: "app1",
          tableId: "tbl1",
          field: { fieldName: "状态", type: 3, property: { options: [{ name: "已确认" }] } },
        },
        fieldContext,
      ),
    ).resolves.toMatchObject({ data: { field: { field_id: "fld1" } } });
    expect(fieldRequests[1]?.url).toContain("/tables/tbl1/fields");

    const updateRequests: RecordedRequest[] = [];
    const updateContext = createContext(updateRequests, [
      tokenResponse(),
      Response.json({ code: 0, msg: "success", data: { field: { field_id: "fld1", field_name: "状态", type: 3 } } }),
    ]);
    await expect(
      feishuBitableActionHandlers.update_field(
        {
          appToken: "app1",
          tableId: "tbl1",
          fieldId: "fld1",
          confirmFieldId: "fld1",
          field: { fieldName: "状态", type: 3, property: { options: [{ name: "已入库" }] } },
        },
        updateContext,
      ),
    ).resolves.toMatchObject({ data: { field: { field_id: "fld1" } } });
    expect(updateRequests[1]?.init?.method).toBe("PUT");

    const deleteRequests: RecordedRequest[] = [];
    const deleteContext = createContext(deleteRequests, [
      tokenResponse(),
      Response.json({ code: 0, msg: "success", data: { field_id: "fld1", deleted: true } }),
    ]);
    await expect(
      feishuBitableActionHandlers.delete_field(
        { appToken: "app1", tableId: "tbl1", fieldId: "fld1", confirmFieldId: "fld1" },
        deleteContext,
      ),
    ).resolves.toMatchObject({ data: { field_id: "fld1", deleted: true } });
    expect(deleteRequests[1]?.init?.method).toBe("DELETE");
    expect(deleteRequests[1]?.url).toContain("/tables/tbl1/fields/fld1");
  });

  it("rejects mismatched destructive IDs before network access", async () => {
    const requests: RecordedRequest[] = [];
    const context = createContext(requests, []);
    await expect(
      Promise.resolve().then(() =>
        feishuBitableActionHandlers.delete_table(
          { appToken: "app1", tableId: "tbl1", confirmTableId: "tbl2" },
          context,
        ),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      Promise.resolve().then(() =>
        feishuBitableActionHandlers.delete_field(
          { appToken: "app1", tableId: "tbl1", fieldId: "fld1", confirmFieldId: "fld2" },
          context,
        ),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(requests).toEqual([]);
  });

  it("rejects missing mutation response fields and maps rate limits", async () => {
    const missing = createContext([], [tokenResponse(), Response.json({ code: 0, msg: "success", data: { app: {} } })]);
    await expect(feishuBitableActionHandlers.create_app({ name: "Production" }, missing)).rejects.toMatchObject({
      status: 502,
    });
    const limited = createContext(
      [],
      [tokenResponse(), Response.json({ code: 11232, msg: "rate limited" }, { status: 429 })],
    );
    await expect(feishuBitableActionHandlers.create_app({ name: "Production" }, limited)).rejects.toMatchObject({
      status: 429,
    });
  });

  it("resolves a Wiki Bitable node to its Base app token", async () => {
    const requests: RecordedRequest[] = [];
    const context = createContext(requests, [
      tokenResponse(),
      Response.json({
        code: 0,
        msg: "success",
        data: { node: { obj_type: "bitable", obj_token: "bascnResolvedAppToken" } },
      }),
    ]);

    await expect(feishuBitableActionHandlers.resolve_wiki_node({ wikiToken: "wiki token" }, context)).resolves.toEqual({
      objType: "bitable",
      objToken: "bascnResolvedAppToken",
      appToken: "bascnResolvedAppToken",
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toBe("https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=wiki+token");
    expect(new Headers(requests[1]?.init?.headers).get("authorization")).toBe("Bearer tenant-token");
  });

  it("does not expose a non-Bitable Wiki object token as an app token", async () => {
    const context = createContext(
      [],
      [
        tokenResponse(),
        Response.json({ code: 0, msg: "success", data: { node: { obj_type: "docx", obj_token: "docx1" } } }),
      ],
    );

    await expect(feishuBitableActionHandlers.resolve_wiki_node({ wikiToken: "wiki1" }, context)).resolves.toEqual({
      objType: "docx",
      objToken: "docx1",
      appToken: null,
    });
  });

  it("rejects malformed Wiki node responses as upstream failures", async () => {
    const context = createContext([], [tokenResponse(), Response.json({ code: 0, msg: "success", data: {} })]);

    await expect(feishuBitableActionHandlers.resolve_wiki_node({ wikiToken: "wiki1" }, context)).rejects.toMatchObject({
      status: 502,
      message: "Feishu response is missing data.node",
    });
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
