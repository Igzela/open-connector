import type { CredentialValidators, ExecutionContext, ProviderExecutors, TransitFileWriter } from "../../core/types.ts";
import type { FeishuBitableActionName } from "./actions.ts";

import {
  compactObject,
  optionalBoolean,
  optionalInteger,
  optionalRecord,
  optionalString,
  requiredRecord,
  requiredString,
} from "../../core/cast.ts";
import { readBoundedResponseBytes } from "../../core/request.ts";
import {
  defineProviderExecutors,
  providerUserAgent,
  ProviderRequestError,
  requireCustomCredential,
} from "../provider-runtime.ts";
import { feishuBitableProviderScopes } from "./scopes.ts";

const service = "feishu_bitable";
const feishuOpenBaseUrl = "https://open.feishu.cn/open-apis";
const requestTimeoutMs = 30_000;
const tokenRefreshSkewMs = 60_000;
const maxAttachmentBytes = 10 * 1024 * 1024;
const allowedAttachmentMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/heic",
  "image/heif",
  "application/pdf",
]);
const rateLimitedCodes = new Set([11232, 11233, 11247, 99991400, 1000004, 1000005]);
const permissionCodes = new Set([10023, 1254302, 1254303, 1254304, 99991672, 99991676, 99991679]);
const credentialCodes = new Set([
  4001, 10005, 10012, 10013, 10014, 10015, 20002, 20005, 99991543, 99991661, 99991663, 99991664, 99991665,
]);

interface FeishuBitableCredential {
  appId: string;
  appSecret: string;
}

export interface FeishuBitableActionContext extends FeishuBitableCredential {
  fetcher: typeof fetch;
  transitFiles?: TransitFileWriter;
  signal?: AbortSignal;
}

interface FeishuEnvelope {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
  tenant_access_token?: unknown;
  expire?: unknown;
}

interface TokenCacheEntry {
  token: string;
  expiresAtMs: number;
}

interface JsonRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Array<[string, string]>;
  body?: Record<string, unknown>;
}

interface RequestSignal {
  signal: AbortSignal;
  cleanup(): void;
}

type RequestPhase = "validate" | "execute";
type FeishuBitableActionHandler = (
  input: Record<string, unknown>,
  context: FeishuBitableActionContext,
) => Promise<unknown>;

const tokenCache = new Map<string, TokenCacheEntry>();

export const feishuBitableActionHandlers: Record<FeishuBitableActionName, FeishuBitableActionHandler> = {
  create_app(input, context) {
    return executeJson(
      {
        method: "POST",
        path: "/bitable/v1/apps",
        body: compactObject({
          name: providerString(input.name, "name"),
          folder_token: optionalString(input.folderToken),
          time_zone: optionalString(input.timeZone),
        }),
      },
      context,
    ).then((response) => validateAppMutationResponse(response, "data.app"));
  },
  create_table(input, context) {
    return executeJson(
      {
        method: "POST",
        path: `/bitable/v1/apps/${segment(input.appToken, "appToken")}/tables`,
        body: { table: tableMutation(input.table) },
      },
      context,
    ).then((response) => validateTableMutationResponse(response, "data.table"));
  },
  update_table(input, context) {
    const name = optionalString(input.name);
    const isAdvanced = optionalBoolean(input.isAdvanced);
    if (name === undefined && isAdvanced === undefined) {
      throw new ProviderRequestError(400, "At least one of name or isAdvanced is required");
    }
    return executeJson(
      {
        method: "PUT",
        path: `/bitable/v1/apps/${segment(input.appToken, "appToken")}`,
        body: compactObject({ name, is_advanced: isAdvanced }),
      },
      context,
    ).then((response) => validateAppMutationResponse(response, "data.app"));
  },
  delete_table(input, context) {
    assertExactId(input.tableId, input.confirmTableId, "tableId");
    return executeJson(
      {
        method: "DELETE",
        path: `/bitable/v1/apps/${segment(input.appToken, "appToken")}/tables/${segment(input.tableId, "tableId")}`,
      },
      context,
    );
  },
  create_field(input, context) {
    return executeJson(
      {
        method: "POST",
        path: `/bitable/v1/apps/${segment(input.appToken, "appToken")}/tables/${segment(input.tableId, "tableId")}/fields`,
        body: fieldMutation(input.field),
      },
      context,
    ).then((response) => validateFieldMutationResponse(response, "data.field"));
  },
  update_field(input, context) {
    assertExactId(input.fieldId, input.confirmFieldId, "fieldId");
    return executeJson(
      {
        method: "PUT",
        path: `/bitable/v1/apps/${segment(input.appToken, "appToken")}/tables/${segment(input.tableId, "tableId")}/fields/${segment(input.fieldId, "fieldId")}`,
        body: fieldMutation(input.field),
      },
      context,
    ).then((response) => validateFieldMutationResponse(response, "data.field"));
  },
  delete_field(input, context) {
    assertExactId(input.fieldId, input.confirmFieldId, "fieldId");
    return executeJson(
      {
        method: "DELETE",
        path: `/bitable/v1/apps/${segment(input.appToken, "appToken")}/tables/${segment(input.tableId, "tableId")}/fields/${segment(input.fieldId, "fieldId")}`,
      },
      context,
    );
  },
  resolve_wiki_node(input, context) {
    return resolveWikiNode(input, context);
  },
  list_tables(input, context) {
    return executeJson(
      {
        method: "GET",
        path: `/bitable/v1/apps/${segment(input.appToken, "appToken")}/tables`,
        query: paginationQuery(input),
      },
      context,
    );
  },
  list_fields(input, context) {
    return executeJson(
      {
        method: "GET",
        path: `/bitable/v1/apps/${segment(input.appToken, "appToken")}/tables/${segment(input.tableId, "tableId")}/fields`,
        query: paginationQuery(input),
      },
      context,
    );
  },
  get_record(input, context) {
    return executeJson(
      {
        method: "GET",
        path: `/bitable/v1/apps/${segment(input.appToken, "appToken")}/tables/${segment(input.tableId, "tableId")}/records/${segment(input.recordId, "recordId")}`,
      },
      context,
    );
  },
  list_records(input, context) {
    return executeJson(
      {
        method: "GET",
        path: `/bitable/v1/apps/${segment(input.appToken, "appToken")}/tables/${segment(input.tableId, "tableId")}/records`,
        query: compactQuery([
          ...paginationQuery(input),
          ["view_id", optionalString(input.viewId)],
          ["filter", optionalString(input.filter)],
          ["sort", stringifyStringArray(input.sort, "sort")],
          ["field_names", stringifyStringArray(input.fieldNames, "fieldNames")],
          ["text_field_as_array", stringifyBoolean(input.textFieldAsArray)],
        ]),
      },
      context,
    );
  },
  create_record(input, context) {
    return executeJson(
      {
        method: "POST",
        path: `/bitable/v1/apps/${segment(input.appToken, "appToken")}/tables/${segment(input.tableId, "tableId")}/records`,
        body: { fields: requiredProviderRecord(input.fields, "fields") },
      },
      context,
    );
  },
  update_record(input, context) {
    return executeJson(
      {
        method: "PUT",
        path: `/bitable/v1/apps/${segment(input.appToken, "appToken")}/tables/${segment(input.tableId, "tableId")}/records/${segment(input.recordId, "recordId")}`,
        body: { fields: requiredProviderRecord(input.fields, "fields") },
      },
      context,
    );
  },
  batch_create_records(input, context) {
    return executeJson(
      {
        method: "POST",
        path: `/bitable/v1/apps/${segment(input.appToken, "appToken")}/tables/${segment(input.tableId, "tableId")}/records/batch_create`,
        body: { records: readBatchRecords(input.records) },
      },
      context,
    );
  },
  download_attachment(input, context) {
    return downloadAttachment(input, context);
  },
};

async function resolveWikiNode(
  input: Record<string, unknown>,
  context: FeishuBitableActionContext,
): Promise<Record<string, unknown>> {
  const response = await executeJson(
    {
      method: "GET",
      path: "/wiki/v2/spaces/get_node",
      query: [["token", providerString(input.wikiToken, "wikiToken")]],
    },
    context,
  );
  const data = requiredFeishuResponseRecord(response.data, "data");
  const node = requiredFeishuResponseRecord(data.node, "data.node");
  const objType = requiredFeishuResponseString(node.obj_type, "data.node.obj_type");
  const objToken = requiredFeishuResponseString(node.obj_token, "data.node.obj_token");
  return {
    objType,
    objToken,
    appToken: objType === "bitable" ? objToken : null,
  };
}

export const executors: ProviderExecutors = defineProviderExecutors<FeishuBitableActionContext>({
  service,
  handlers: feishuBitableActionHandlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch): Promise<FeishuBitableActionContext> {
    const credential = await requireCustomCredential(context, service);
    const providerContext: FeishuBitableActionContext = {
      ...readCredential(credential.values),
      fetcher,
      signal: context.signal,
    };
    if (context.transitFiles) {
      providerContext.transitFiles = context.transitFiles;
    }
    return providerContext;
  },
  fallbackMessage: "Feishu Bitable request failed",
});

export const credentialValidators: CredentialValidators = {
  async customCredential(input, { fetcher, signal }) {
    const credential = readCredential(input.values);
    await fetchTenantAccessToken(credential, fetcher, "validate", signal);
    return {
      profile: {
        accountId: credential.appId,
        displayName: credential.appId,
      },
      grantedScopes: feishuBitableProviderScopes,
      metadata: { appId: credential.appId },
    };
  },
};

function readCredential(values: Record<string, string>): FeishuBitableCredential {
  return {
    appId: providerString(values.appId, "appId"),
    appSecret: providerString(values.appSecret, "appSecret"),
  };
}

async function executeJson(input: JsonRequest, context: FeishuBitableActionContext): Promise<Record<string, unknown>> {
  const accessToken = await fetchTenantAccessToken(context, context.fetcher, "execute", context.signal);
  return requestJson({ ...input, accessToken, fetcher: context.fetcher, phase: "execute", signal: context.signal });
}

async function fetchTenantAccessToken(
  credential: FeishuBitableCredential,
  fetcher: typeof fetch,
  phase: RequestPhase,
  signal?: AbortSignal,
): Promise<string> {
  const now = Date.now();
  const cacheKey = `${credential.appId}\u0000${credential.appSecret}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) {
    return cached.token;
  }

  const envelope = await requestJson({
    method: "POST",
    path: "/auth/v3/tenant_access_token/internal",
    body: { app_id: credential.appId, app_secret: credential.appSecret },
    fetcher,
    phase,
    signal,
  });
  const token = optionalString(envelope.tenant_access_token);
  if (!token) {
    throw new ProviderRequestError(502, "Feishu tenant_access_token is missing");
  }
  const expireSeconds = optionalInteger(envelope.expire) ?? 0;
  if (expireSeconds > 0) {
    tokenCache.set(cacheKey, {
      token,
      expiresAtMs: Math.max(now, now + expireSeconds * 1000 - tokenRefreshSkewMs),
    });
  }
  return token;
}

async function requestJson(
  input: JsonRequest & {
    accessToken?: string;
    fetcher: typeof fetch;
    phase: RequestPhase;
    signal?: AbortSignal;
  },
): Promise<Record<string, unknown>> {
  const url = new URL(`${feishuOpenBaseUrl}${input.path}`);
  for (const [key, value] of input.query ?? []) {
    url.searchParams.set(key, value);
  }
  const headers: Record<string, string> = { "user-agent": providerUserAgent };
  if (input.accessToken) {
    headers.authorization = `Bearer ${input.accessToken}`;
  }
  if (input.body) {
    headers["content-type"] = "application/json; charset=utf-8";
  }

  const requestSignal = createRequestSignal(input.signal);
  try {
    const response = await input.fetcher(url, {
      method: input.method,
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: requestSignal.signal,
    });
    const rawText = await response.text();
    const envelope = parseEnvelope(rawText);
    const code = typeof envelope.code === "number" ? envelope.code : 0;
    if (!response.ok || code !== 0) {
      throw mapFeishuError(response.status, envelope, rawText, input.phase);
    }
    return {
      code,
      msg: optionalString(envelope.msg) ?? "success",
      ...(envelope.data !== undefined ? { data: envelope.data } : {}),
      ...(envelope.tenant_access_token !== undefined ? { tenant_access_token: envelope.tenant_access_token } : {}),
      ...(envelope.expire !== undefined ? { expire: envelope.expire } : {}),
    };
  } catch (error) {
    throw normalizeTransportError(error, "requesting Feishu Bitable");
  } finally {
    requestSignal.cleanup();
  }
}

async function downloadAttachment(
  input: Record<string, unknown>,
  context: FeishuBitableActionContext,
): Promise<Record<string, unknown>> {
  if (!context.transitFiles) {
    throw new ProviderRequestError(500, "download_attachment requires OpenConnector transit file storage");
  }
  const fileToken = providerString(input.fileToken, "fileToken");
  const accessToken = await fetchTenantAccessToken(context, context.fetcher, "execute", context.signal);
  const requestSignal = createRequestSignal(context.signal);
  try {
    const response = await context.fetcher(
      `${feishuOpenBaseUrl}/drive/v1/medias/${encodeURIComponent(fileToken)}/download`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "user-agent": providerUserAgent,
        },
        signal: requestSignal.signal,
      },
    );
    if (!response.ok) {
      const rawText = await response.text();
      let envelope: FeishuEnvelope;
      try {
        envelope = parseEnvelope(rawText);
      } catch {
        throw new ProviderRequestError(
          response.status >= 500 ? 502 : response.status,
          rawText.trim() || `Feishu attachment download failed with HTTP ${response.status}`,
        );
      }
      throw mapFeishuError(response.status, envelope, rawText, "execute");
    }

    const mimeType = normalizeMimeType(response.headers.get("content-type"));
    if (!mimeType || !allowedAttachmentMimeTypes.has(mimeType)) {
      throw new ProviderRequestError(415, `Feishu attachment MIME type is not allowed: ${mimeType || "missing"}`);
    }
    const advertisedSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(advertisedSize) && advertisedSize > maxAttachmentBytes) {
      throw new ProviderRequestError(413, `Feishu attachment exceeds ${maxAttachmentBytes} bytes`);
    }
    const maxBytes = Math.min(maxAttachmentBytes, context.transitFiles.maxBytes);
    const bytes = await readBoundedResponseBytes(response, {
      maxBytes,
      fieldName: "Feishu attachment",
      createError: (message) => new ProviderRequestError(413, message),
    });
    const fileName = sanitizeFileName(
      optionalString(input.fileName) ??
        readContentDispositionFileName(response.headers.get("content-disposition")) ??
        `feishu-${fileToken}`,
    );
    const upload = await context.transitFiles.create(new File([Uint8Array.from(bytes)], fileName, { type: mimeType }));
    return {
      fileToken,
      file: {
        fileId: upload.fileId,
        downloadUrl: upload.downloadUrl,
        name: upload.name,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
      },
    };
  } catch (error) {
    throw normalizeTransportError(error, "downloading Feishu attachment");
  } finally {
    requestSignal.cleanup();
  }
}

function readBatchRecords(value: unknown): Array<{ fields: Record<string, unknown> }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) {
    throw new ProviderRequestError(400, "records must contain between 1 and 1000 items");
  }
  return value.map((item, index) => ({
    fields: requiredProviderRecord(
      requiredProviderRecord(item, `records[${index}]`).fields,
      `records[${index}].fields`,
    ),
  }));
}

function tableMutation(value: unknown): Record<string, unknown> {
  const table = requiredRecord(value, "table", (message) => new ProviderRequestError(400, message));
  const fields = table.fields;
  return compactObject({
    name: providerString(table.name, "table.name"),
    default_view_name: optionalString(table.defaultViewName),
    fields: fields === undefined ? undefined : readFieldMutationArray(fields, "table.fields"),
  });
}

function fieldMutation(value: unknown): Record<string, unknown> {
  const field = requiredRecord(value, "field", (message) => new ProviderRequestError(400, message));
  const type = optionalInteger(field.type);
  if (type === undefined || type < 1 || type > 100) {
    throw new ProviderRequestError(400, "field.type must be an integer from 1 to 100");
  }
  return compactObject({
    field_name: providerString(field.fieldName, "field.fieldName"),
    type,
    property:
      field.property === undefined
        ? undefined
        : requiredRecord(field.property, "field.property", (message) => new ProviderRequestError(400, message)),
    description: optionalString(field.description),
    ui_type: optionalString(field.uiType),
  });
}

function readFieldMutationArray(value: unknown, fieldName: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 300) {
    throw new ProviderRequestError(400, `${fieldName} must contain no more than 300 fields`);
  }
  return value.map((item, index) => fieldMutation(itemForField(item, `${fieldName}[${index}]`)));
}

function itemForField(value: unknown, fieldName: string): Record<string, unknown> {
  return requiredRecord(value, fieldName, (message) => new ProviderRequestError(400, message));
}

function assertExactId(value: unknown, confirmation: unknown, fieldName: string): void {
  const actual = providerString(value, fieldName);
  const expected = providerString(confirmation, `confirm${fieldName[0]!.toUpperCase()}${fieldName.slice(1)}`);
  if (actual !== expected) throw new ProviderRequestError(400, `${fieldName} and its confirmation must match exactly`);
}

function validateAppMutationResponse(response: Record<string, unknown>, fieldName: string): Record<string, unknown> {
  const data = requiredFeishuResponseRecord(response.data, "data");
  const app = requiredFeishuResponseRecord(data.app, fieldName);
  requiredFeishuResponseString(app.app_token, `${fieldName}.app_token`);
  requiredFeishuResponseString(app.name, `${fieldName}.name`);
  return response;
}

function validateTableMutationResponse(response: Record<string, unknown>, fieldName: string): Record<string, unknown> {
  const data = requiredFeishuResponseRecord(response.data, "data");
  const table = requiredFeishuResponseRecord(data.table, fieldName);
  requiredFeishuResponseString(table.table_id, `${fieldName}.table_id`);
  requiredFeishuResponseString(table.name, `${fieldName}.name`);
  return response;
}

function validateFieldMutationResponse(response: Record<string, unknown>, fieldName: string): Record<string, unknown> {
  const data = requiredFeishuResponseRecord(response.data, "data");
  const field = requiredFeishuResponseRecord(data.field, fieldName);
  requiredFeishuResponseString(field.field_id, `${fieldName}.field_id`);
  requiredFeishuResponseString(field.field_name, `${fieldName}.field_name`);
  if (optionalInteger(field.type) === undefined) throw new ProviderRequestError(502, `${fieldName}.type is missing`);
  return response;
}

function paginationQuery(input: Record<string, unknown>): Array<[string, string]> {
  const pageSize = optionalInteger(input.pageSize);
  if (input.pageSize !== undefined && (pageSize === undefined || pageSize < 1 || pageSize > 500)) {
    throw new ProviderRequestError(400, "pageSize must be an integer from 1 to 500");
  }
  return compactQuery([
    ["page_size", pageSize === undefined ? undefined : String(pageSize)],
    ["page_token", optionalString(input.pageToken)],
  ]);
}

function stringifyStringArray(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new ProviderRequestError(400, `${fieldName} must be an array of non-empty strings`);
  }
  return JSON.stringify(value);
}

function stringifyBoolean(value: unknown): string | undefined {
  const parsed = optionalBoolean(value);
  if (value !== undefined && parsed === undefined) {
    throw new ProviderRequestError(400, "textFieldAsArray must be a boolean");
  }
  return parsed === undefined ? undefined : String(parsed);
}

function compactQuery(entries: Array<[string, string | undefined]>): Array<[string, string]> {
  return entries.filter((entry): entry is [string, string] => entry[1] !== undefined);
}

function segment(value: unknown, fieldName: string): string {
  return encodeURIComponent(providerString(value, fieldName));
}

function providerString(value: unknown, fieldName: string): string {
  return requiredString(value, fieldName, (message) => new ProviderRequestError(400, message));
}

function requiredProviderRecord(value: unknown, fieldName: string): Record<string, unknown> {
  return requiredRecord(value, fieldName, (message) => new ProviderRequestError(400, message));
}

function requiredFeishuResponseRecord(value: unknown, fieldName: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) {
    throw new ProviderRequestError(502, `Feishu response is missing ${fieldName}`);
  }
  return record;
}

function requiredFeishuResponseString(value: unknown, fieldName: string): string {
  const text = optionalString(value);
  if (!text) {
    throw new ProviderRequestError(502, `Feishu response is missing ${fieldName}`);
  }
  return text;
}

function parseEnvelope(rawText: string): FeishuEnvelope {
  try {
    return JSON.parse(rawText) as FeishuEnvelope;
  } catch {
    throw new ProviderRequestError(502, "Feishu returned invalid JSON");
  }
}

function mapFeishuError(
  status: number,
  envelope: FeishuEnvelope,
  rawText: string,
  phase: RequestPhase,
): ProviderRequestError {
  const code = typeof envelope.code === "number" ? envelope.code : null;
  const message = optionalString(envelope.msg) ?? (rawText.trim() || `Feishu request failed with HTTP ${status}`);
  const tagged = code === null ? message : `Feishu ${code}: ${message}`;
  if (status === 429 || (code !== null && rateLimitedCodes.has(code))) {
    return new ProviderRequestError(429, tagged, envelope);
  }
  if (phase === "validate") {
    return new ProviderRequestError(status >= 500 ? 502 : 400, tagged, envelope);
  }
  if (status === 401 || (code !== null && credentialCodes.has(code))) {
    return new ProviderRequestError(401, tagged, envelope);
  }
  if (status === 403 || (code !== null && permissionCodes.has(code))) {
    return new ProviderRequestError(403, tagged, envelope);
  }
  if (status >= 400 && status < 500) {
    return new ProviderRequestError(status, tagged, envelope);
  }
  if (code !== null && code !== 0) {
    return new ProviderRequestError(400, tagged, envelope);
  }
  return new ProviderRequestError(502, tagged, envelope);
}

function normalizeTransportError(error: unknown, activity: string): ProviderRequestError {
  if (error instanceof ProviderRequestError) {
    return error;
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new ProviderRequestError(504, `Timed out while ${activity}`);
  }
  return new ProviderRequestError(502, error instanceof Error ? error.message : `Failed while ${activity}`, error);
}

function createRequestSignal(signal?: AbortSignal): RequestSignal {
  const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
  return {
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    cleanup() {},
  };
}

function normalizeMimeType(value: string | null): string | null {
  return value?.split(";", 1)[0]?.trim().toLowerCase() || null;
}

function readContentDispositionFileName(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(value)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return undefined;
    }
  }
  return /filename="?([^";]+)"?/iu.exec(value)?.[1]?.trim();
}

function sanitizeFileName(value: string): string {
  const leaf = value.split(/[\\/]/u).at(-1)?.trim() || "feishu-attachment";
  const safe = Array.from(leaf, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? "_" : character;
  })
    .join("")
    .slice(0, 255);
  return safe || "feishu-attachment";
}
