import type { ActionDefinition, JsonSchema } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";
import { feishuBitableScopes } from "./scopes.ts";

const service = "feishu_bitable";
const requiredScopes = [feishuBitableScopes.app];
const wikiRequiredScopes = [feishuBitableScopes.wikiReadonly];

const appTokenSchema = s.nonEmptyString("The Feishu Base app_token. A wiki node token is not an app_token.");
const tableIdSchema = s.nonEmptyString("The Feishu Base table_id.");
const recordIdSchema = s.nonEmptyString("The Feishu Base record_id.");
const pageSizeSchema = s.integer("Number of items requested from Feishu for this page.", {
  minimum: 1,
  maximum: 500,
  default: 100,
});
const fieldsSchema = s.record(
  "Record fields keyed by Feishu field name or field ID.",
  s.unknown("A Feishu field value."),
);
const recordSchema = s.looseRequiredObject(
  "One Feishu Base record.",
  {
    record_id: s.string("The Feishu record ID."),
    fields: fieldsSchema,
    created_by: s.looseObject({}, { description: "The record creator." }),
    created_time: s.integer("Record creation time in milliseconds."),
    last_modified_by: s.looseObject({}, { description: "The last record editor." }),
    last_modified_time: s.integer("Last modification time in milliseconds."),
  },
  { optional: ["record_id", "fields", "created_by", "created_time", "last_modified_by", "last_modified_time"] },
);
const tableSchema = s.looseRequiredObject(
  "One Feishu Base table.",
  {
    table_id: s.string("The table ID."),
    name: s.string("The table name."),
    revision: s.integer("The table revision."),
  },
  { optional: ["table_id", "name", "revision"] },
);
const fieldSchema = s.looseRequiredObject(
  "One Feishu Base field.",
  {
    field_id: s.string("The field ID."),
    field_name: s.string("The display name of the field."),
    type: s.integer("The Feishu field type code."),
    is_primary: s.boolean("Whether this is the primary field."),
    property: s.looseObject({}, { description: "Provider-specific field configuration." }),
  },
  { optional: ["field_id", "field_name", "type", "is_primary", "property"] },
);

function envelopeSchema(description: string, data: JsonSchema): JsonSchema {
  return s.looseRequiredObject(description, {
    code: s.integer("Feishu result code. Zero means success."),
    msg: s.string("Feishu result message."),
    data,
  });
}

const tableListOutput = envelopeSchema(
  "Feishu table-list response.",
  s.looseRequiredObject(
    "Paginated Feishu table data.",
    {
      items: s.array("Tables in this page.", tableSchema),
      has_more: s.boolean("Whether another page exists."),
      page_token: s.string("Token for the next page."),
    },
    { optional: ["items", "has_more", "page_token"] },
  ),
);
const fieldListOutput = envelopeSchema(
  "Feishu field-list response.",
  s.looseRequiredObject(
    "Paginated Feishu field data.",
    {
      items: s.array("Fields in this page.", fieldSchema),
      has_more: s.boolean("Whether another page exists."),
      page_token: s.string("Token for the next page."),
    },
    { optional: ["items", "has_more", "page_token"] },
  ),
);
const recordOutput = envelopeSchema(
  "Feishu single-record response.",
  s.looseRequiredObject("Feishu record data.", { record: recordSchema }, { optional: ["record"] }),
);
const recordListOutput = envelopeSchema(
  "Feishu record-list response.",
  s.looseRequiredObject(
    "Paginated Feishu record data.",
    {
      items: s.array("Records in this page.", recordSchema),
      total: s.integer("Total matching records when returned by Feishu."),
      has_more: s.boolean("Whether another page exists."),
      page_token: s.string("Token for the next page."),
    },
    { optional: ["items", "total", "has_more", "page_token"] },
  ),
);
const batchRecordOutput = envelopeSchema(
  "Feishu batch-create response.",
  s.looseRequiredObject(
    "Batch result data. Feishu may include per-record errors for a partial failure.",
    {
      records: s.array("Successfully created records.", recordSchema),
      errors: s.array("Per-record failures when supplied by Feishu.", s.looseObject({})),
    },
    { optional: ["records", "errors"] },
  ),
);
const transitFileSchema = s.requiredObject("The downloaded attachment stored in OpenConnector transit storage.", {
  fileId: s.string("The transit file ID."),
  downloadUrl: s.string("The bounded local transit download URL."),
  name: s.string("The attachment filename."),
  mimeType: s.string("The validated MIME type."),
  sizeBytes: s.integer("Downloaded attachment size in bytes."),
});
const uploadedTransitFileSchema = s.transitFile(
  "A local transit file previously uploaded to OpenConnector before sending it to Feishu.",
);

const fieldMutationSchema = s.object(
  "A strict Feishu field definition.",
  {
    fieldName: s.string({ description: "The field display name.", minLength: 1, maxLength: 100 }),
    type: s.integer("The Feishu field type code.", { minimum: 1, maximum: 100 }),
    property: s.record("The complete Feishu field property object.", s.unknown("A property value.")),
    description: s.string("Optional field description.", { maxLength: 2000 }),
    uiType: s.string("Optional Feishu field UI type.", { minLength: 1, maxLength: 32 }),
  },
  { optional: ["property", "description", "uiType"] },
);
const fieldMutationItemSchema = s.object(
  "One field to create in a Feishu table.",
  {
    fieldName: s.string({ description: "The field display name.", minLength: 1, maxLength: 100 }),
    type: s.integer("The Feishu field type code.", { minimum: 1, maximum: 100 }),
    property: s.record("The complete Feishu field property object.", s.unknown("A property value.")),
    description: s.string("Optional field description.", { maxLength: 2000 }),
    uiType: s.string("Optional Feishu field UI type.", { minLength: 1, maxLength: 32 }),
  },
  { optional: ["property", "description", "uiType"] },
);
const appOutput = envelopeSchema(
  "Feishu Base creation or update response.",
  s.looseRequiredObject(
    "Feishu Base metadata.",
    {
      app: s.looseRequiredObject(
        "Feishu Base metadata.",
        {
          app_token: s.nonEmptyString("The Base app_token."),
          name: s.nonEmptyString("The Base name."),
          url: s.string("The Base URL.", { minLength: 1 }),
          default_table_id: s.nonEmptyString("The default table ID."),
        },
        { optional: ["url", "default_table_id"] },
      ),
    },
    { optional: ["app"] },
  ),
);
const tableCreateOutput = envelopeSchema(
  "Feishu table creation response.",
  s.looseRequiredObject(
    "Feishu created table metadata.",
    {
      table_id: s.nonEmptyString("The created table ID."),
      default_view_id: s.nonEmptyString("The default view ID."),
      field_id_list: s.array("IDs of fields created with the table.", s.nonEmptyString("A field ID.")),
    },
    { optional: ["default_view_id", "field_id_list"] },
  ),
);
const mutationDeleteOutput = envelopeSchema("Feishu deletion response.", s.requiredObject("Empty Feishu data.", {}));
const fieldMutationOutput = envelopeSchema(
  "Feishu field mutation response.",
  s.looseRequiredObject(
    "Feishu field metadata.",
    {
      field: s.looseRequiredObject(
        "The affected field.",
        {
          field_id: s.nonEmptyString("The affected field ID."),
          field_name: s.nonEmptyString("The affected field name."),
          type: s.integer("The Feishu field type code."),
          is_primary: s.boolean("Whether this is the primary field."),
          property: s.looseObject({}, { description: "Provider-specific field configuration." }),
        },
        { optional: ["is_primary", "property"] },
      ),
    },
    { optional: [] },
  ),
);
const attachmentMutationOutput = s.requiredObject("Uploaded and attached Feishu Base file.", {
  fileToken: s.nonEmptyString("The uploaded Feishu attachment file_token."),
  record: recordSchema,
});

function paginationProperties() {
  return {
    pageSize: pageSizeSchema,
    pageToken: s.string("The Feishu page_token returned by the previous request.", { minLength: 1 }),
  };
}

export const feishuBitableActions: ActionDefinition[] = [
  defineProviderAction(service, {
    name: "create_app",
    description: "Create one Feishu Base with the official Server API.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.object(
      "Input for creating one Feishu Base.",
      {
        name: s.string({ description: "The Base name.", minLength: 1, maxLength: 255 }),
        folderToken: s.string("Optional folder token.", { minLength: 1 }),
        timeZone: s.string("Optional IANA time zone.", { minLength: 1 }),
      },
      { optional: ["folderToken", "timeZone"] },
    ),
    outputSchema: appOutput,
  }),
  defineProviderAction(service, {
    name: "create_table",
    description: "Create one explicitly named Feishu Base table, optionally with fields.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.requiredObject("Input for creating one Feishu table.", {
      appToken: appTokenSchema,
      table: s.object(
        "The official Feishu table object.",
        {
          name: s.string({ description: "The table name.", minLength: 1, maxLength: 100 }),
          defaultViewName: s.string("Optional default view name.", { minLength: 1, maxLength: 100 }),
          fields: s.array("Optional fields created with the table.", fieldMutationItemSchema, { maxItems: 300 }),
        },
        { optional: ["defaultViewName", "fields"] },
      ),
    }),
    outputSchema: tableCreateOutput,
  }),
  defineProviderAction(service, {
    name: "update_table",
    description: "Update one Feishu Base metadata object by exact app token.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.object(
      "Input for updating one Feishu Base.",
      {
        appToken: appTokenSchema,
        name: s.string({ description: "Optional replacement Base name.", minLength: 1, maxLength: 100 }),
        isAdvanced: s.boolean("Optional advanced-permission setting."),
      },
      { optional: ["name", "isAdvanced"] },
    ),
    outputSchema: appOutput,
  }),
  defineProviderAction(service, {
    name: "delete_table",
    description: "Delete one Feishu Base table only when tableId and confirmTableId match exactly.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.requiredObject("Input for deleting one exact Feishu table.", {
      appToken: appTokenSchema,
      tableId: tableIdSchema,
      confirmTableId: tableIdSchema,
    }),
    outputSchema: mutationDeleteOutput,
  }),
  defineProviderAction(service, {
    name: "create_field",
    description: "Create one explicitly named Feishu field with an official field type and property.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.requiredObject("Input for creating one Feishu field.", {
      appToken: appTokenSchema,
      tableId: tableIdSchema,
      field: fieldMutationSchema,
    }),
    outputSchema: fieldMutationOutput,
  }),
  defineProviderAction(service, {
    name: "update_field",
    description: "Replace one exact Feishu field definition, including its property/options.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.requiredObject("Input for updating one exact Feishu field.", {
      appToken: appTokenSchema,
      tableId: tableIdSchema,
      fieldId: s.nonEmptyString("The exact field ID."),
      confirmFieldId: s.nonEmptyString("The exact field ID confirmation."),
      field: fieldMutationSchema,
    }),
    outputSchema: fieldMutationOutput,
  }),
  defineProviderAction(service, {
    name: "delete_field",
    description: "Delete one Feishu field only when fieldId and confirmFieldId match exactly.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.requiredObject("Input for deleting one exact Feishu field.", {
      appToken: appTokenSchema,
      tableId: tableIdSchema,
      fieldId: s.nonEmptyString("The exact field ID."),
      confirmFieldId: s.nonEmptyString("The exact field ID confirmation."),
    }),
    outputSchema: mutationDeleteOutput,
  }),
  defineProviderAction(service, {
    name: "resolve_wiki_node",
    description: "Resolve a Feishu Wiki node token to its backing object and Base app token when it is a Bitable.",
    requiredScopes: wikiRequiredScopes,
    providerPermissions: wikiRequiredScopes,
    inputSchema: s.requiredObject("Input for resolving one Feishu Wiki node.", {
      wikiToken: s.nonEmptyString("The Wiki node token from a /wiki/ URL."),
    }),
    outputSchema: s.requiredObject("Resolved Feishu Wiki node.", {
      objType: s.nonEmptyString("The Feishu object type backing the Wiki node."),
      objToken: s.nonEmptyString("The Feishu object token backing the Wiki node."),
      appToken: s.nullable(s.nonEmptyString("The Feishu Base app_token when objType is bitable; otherwise null.")),
    }),
  }),
  defineProviderAction(service, {
    name: "list_tables",
    description: "List tables in one Feishu Base with explicit page-token pagination.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.object(
      "Input for listing Base tables.",
      { appToken: appTokenSchema, ...paginationProperties() },
      { optional: ["pageSize", "pageToken"] },
    ),
    outputSchema: tableListOutput,
  }),
  defineProviderAction(service, {
    name: "list_fields",
    description: "List fields in one Feishu Base table with explicit page-token pagination.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.object(
      "Input for listing table fields.",
      { appToken: appTokenSchema, tableId: tableIdSchema, ...paginationProperties() },
      { optional: ["pageSize", "pageToken"] },
    ),
    outputSchema: fieldListOutput,
  }),
  defineProviderAction(service, {
    name: "get_record",
    description: "Get one Feishu Base record by record ID.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.requiredObject("Input for getting one Base record.", {
      appToken: appTokenSchema,
      tableId: tableIdSchema,
      recordId: recordIdSchema,
    }),
    outputSchema: recordOutput,
  }),
  defineProviderAction(service, {
    name: "list_records",
    description: "List Feishu Base records with view, filter, field-selection, and page-token controls.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.object(
      "Input for listing Base records.",
      {
        appToken: appTokenSchema,
        tableId: tableIdSchema,
        viewId: s.string("Optional Feishu view ID.", { minLength: 1 }),
        filter: s.string("Optional Feishu filter expression.", { minLength: 1 }),
        sort: s.stringArray("Optional Feishu sort expressions."),
        fieldNames: s.stringArray("Optional field names returned by Feishu."),
        textFieldAsArray: s.boolean("Return text fields as structured arrays when supported."),
        ...paginationProperties(),
      },
      { optional: ["viewId", "filter", "sort", "fieldNames", "textFieldAsArray", "pageSize", "pageToken"] },
    ),
    outputSchema: recordListOutput,
  }),
  defineProviderAction(service, {
    name: "create_record",
    description: "Create one Feishu Base record. This write is sent once and is never blindly retried.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.requiredObject("Input for creating one Base record.", {
      appToken: appTokenSchema,
      tableId: tableIdSchema,
      fields: fieldsSchema,
    }),
    outputSchema: recordOutput,
  }),
  defineProviderAction(service, {
    name: "update_record",
    description: "Update fields on one Feishu Base record. This write is sent once and is never blindly retried.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.requiredObject("Input for updating one Base record.", {
      appToken: appTokenSchema,
      tableId: tableIdSchema,
      recordId: recordIdSchema,
      fields: fieldsSchema,
    }),
    outputSchema: recordOutput,
  }),
  defineProviderAction(service, {
    name: "batch_create_records",
    description:
      "Create up to 1,000 Feishu Base records in one request without automatic retry; preserve provider partial-failure details.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.requiredObject("Input for batch-creating Base records.", {
      appToken: appTokenSchema,
      tableId: tableIdSchema,
      records: s.array("Records to create.", s.requiredObject("One record creation item.", { fields: fieldsSchema }), {
        minItems: 1,
        maxItems: 1000,
      }),
    }),
    outputSchema: batchRecordOutput,
  }),
  defineProviderAction(service, {
    name: "download_attachment",
    description:
      "Download one Feishu Base attachment by file token after enforcing the provider MIME allowlist and a 10 MiB limit.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.object(
      "Input for downloading one Base attachment.",
      {
        fileToken: s.nonEmptyString("The Feishu attachment file_token."),
        fileName: s.string("Optional safe output filename.", { minLength: 1, maxLength: 255 }),
      },
      { optional: ["fileName"] },
    ),
    outputSchema: s.requiredObject("Downloaded Feishu attachment result.", {
      fileToken: s.string("The source Feishu file token."),
      file: transitFileSchema,
    }),
  }),
  defineProviderAction(service, {
    name: "upload_attachment",
    description:
      "Upload one bounded image or PDF transit file to an exact Feishu Base attachment field and attach it to an exact record.",
    requiredScopes,
    providerPermissions: requiredScopes,
    inputSchema: s.requiredObject("Input for uploading one Base attachment.", {
      appToken: appTokenSchema,
      tableId: tableIdSchema,
      recordId: recordIdSchema,
      fieldId: s.nonEmptyString("The exact Feishu attachment field ID."),
      file: uploadedTransitFileSchema,
      append: s.boolean("Append to existing attachments when true; replace them when false."),
    }),
    outputSchema: attachmentMutationOutput,
  }),
];

export type FeishuBitableActionName =
  | "create_app"
  | "create_table"
  | "update_table"
  | "delete_table"
  | "create_field"
  | "update_field"
  | "delete_field"
  | "resolve_wiki_node"
  | "list_tables"
  | "list_fields"
  | "get_record"
  | "list_records"
  | "create_record"
  | "update_record"
  | "batch_create_records"
  | "download_attachment"
  | "upload_attachment";
