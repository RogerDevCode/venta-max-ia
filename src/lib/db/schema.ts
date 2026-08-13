import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ============================================================
 * Auth (Better Auth + plugin organization)
 * ============================================================ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  metadata: text("metadata"),
});

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/* ============================================================
 * Dominio (toda tabla lleva organization_id NOT NULL + índice org-first)
 * ============================================================ */

export const contact = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["telegram", "whatsapp", "test", "retired_whatsapp"] }).notNull(),
    externalAddress: text("external_address").notNull(),
    name: text("name").notNull(),
    assignedUserId: text("assigned_user_id").references(() => user.id, { onDelete: "set null" }),
    notes: text("notes"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_org_channel_address_uq").on(t.organizationId, t.channel, t.externalAddress),
    index("contact_org_name_idx").on(t.organizationId, t.name),
  ]
);

export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    /** open = etapa normal · won / lost = anclas no borrables */
    kind: text("kind", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("stage_org_pos_idx").on(t.organizationId, t.position)]
);

export const lead = pgTable(
  "lead",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    stageId: text("stage_id")
      .notNull()
      .references(() => pipelineStage.id),
    assignedUserId: text("assigned_user_id").references(() => user.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_contact_uq").on(t.contactId),
    index("lead_org_stage_idx").on(t.organizationId, t.stageId, t.position),
  ]
);

export const conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    /** Conversación del Laboratorio: jamás toca la API de Telegram. */
    isTest: boolean("is_test").notNull().default(false),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    assignedUserId: text("assigned_user_id").references(() => user.id, { onDelete: "set null" }),
    handoffAt: timestamp("handoff_at"),
    handoffReason: text("handoff_reason", {
      enum: ["cliente", "modelo", "error", "ventana"],
    }),
    lastInboundAt: timestamp("last_inbound_at"),
    lastMessageAt: timestamp("last_message_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    stateMetadata: jsonb("state_metadata")
      .$type<Record<string, unknown>>()
      .default({}),
    fsmRevision: bigint("fsm_revision", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Una conversación real por contacto; las de prueba no compiten.
    uniqueIndex("conversation_org_contact_real_uq")
      .on(t.organizationId, t.contactId)
      .where(sql`${t.isTest} = false`),
    index("conversation_org_last_idx").on(t.organizationId, t.lastMessageAt),
  ]
);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["telegram", "whatsapp"] }).notNull().default("telegram"),
    integrationId: text("integration_id"),
    externalMessageId: text("external_message_id"),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    type: text("type").notNull().default("text"),
    text: text("text"),
    status: text("status", {
      enum: ["pending", "sent", "delivered", "read", "failed"],
    })
      .notNull()
      .default("pending"),
    error: text("error"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    externalTimestamp: timestamp("external_timestamp"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("message_org_conv_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt
    ),
    uniqueIndex("message_org_integration_external_uq")
      .on(t.organizationId, t.integrationId, t.externalMessageId)
      .where(sql`${t.integrationId} is not null and ${t.externalMessageId} is not null`),
  ]
);

/** Ruta de webhook Telegram por organización; el token se conserva solo como hash. */
export const telegramIntegration = pgTable(
  "telegram_integration",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    webhookTokenHash: text("webhook_token_hash").notNull(),
    webhookHeaderSecretHash: text("webhook_header_secret_hash"),
    webhookRouteSecretCipher: text("webhook_route_secret_cipher"),
    webhookRouteSecretIv: text("webhook_route_secret_iv"),
    webhookRouteSecretTag: text("webhook_route_secret_tag"),
    webhookHeaderSecretCipher: text("webhook_header_secret_cipher"),
    webhookHeaderSecretIv: text("webhook_header_secret_iv"),
    webhookHeaderSecretTag: text("webhook_header_secret_tag"),
    previousWebhookRouteSecretCipher: text("previous_webhook_route_secret_cipher"),
    previousWebhookRouteSecretIv: text("previous_webhook_route_secret_iv"),
    previousWebhookRouteSecretTag: text("previous_webhook_route_secret_tag"),
    previousWebhookHeaderSecretCipher: text("previous_webhook_header_secret_cipher"),
    previousWebhookHeaderSecretIv: text("previous_webhook_header_secret_iv"),
    previousWebhookHeaderSecretTag: text("previous_webhook_header_secret_tag"),
    tokenCipher: text("token_cipher"),
    tokenIv: text("token_iv"),
    tokenTag: text("token_tag"),
    botId: bigint("bot_id", { mode: "number" }),
    botUsername: text("bot_username"),
    notificationChatId: text("notification_chat_id"),
    status: text("status", { enum: ["pending", "header_pending", "connected", "reconnect_required", "failed"] }).notNull().default("reconnect_required"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("telegram_integration_org_uq").on(t.organizationId),
    uniqueIndex("telegram_integration_token_hash_uq").on(t.webhookTokenHash),
    uniqueIndex("telegram_integration_bot_id_uq").on(t.botId),
  ]
);

export const whatsappIntegration = pgTable(
  "whatsapp_integration",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    verifyTokenHash: text("verify_token_hash").notNull(),
    phoneNumberId: text("phone_number_id"),
    wabaId: text("waba_id"),
    status: text("status", { enum: ["pending", "connected", "failed"] }).notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("whatsapp_integration_org_uq").on(t.organizationId),
  ]
);

/** Evidencia idempotente de cada update Telegram recibido antes de su ingesta. */
export const telegramWebhookReceipt = pgTable(
  "telegram_webhook_receipt",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    integrationId: text("integration_id")
      .notNull()
      .references(() => telegramIntegration.id, { onDelete: "cascade" }),
    updateId: bigint("update_id", { mode: "number" }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    conversationId: text("conversation_id").references(() => conversation.id, { onDelete: "set null" }),
    expectedFsmRevision: bigint("expected_fsm_revision", { mode: "number" }),
    expectedFsmStateKey: text("expected_fsm_state_key"),
    status: text("status", { enum: ["received", "processing", "processed", "ignored", "retryable_failed", "failed", "conflict"] })
      .notNull()
      .default("received"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at").notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at"),
    lastError: text("last_error"),
    ignoredReason: text("ignored_reason"),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (t) => [
    uniqueIndex("telegram_receipt_integration_update_uq").on(t.organizationId, t.integrationId, t.updateId),
    index("telegram_receipt_org_status_available_idx").on(t.organizationId, t.status, t.availableAt),
    index("telegram_receipt_org_received_idx").on(t.organizationId, t.receivedAt),
  ]
);

export const telegramWebhookRejection = pgTable(
  "telegram_webhook_rejection",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    integrationId: text("integration_id").notNull().references(() => telegramIntegration.id, { onDelete: "cascade" }),
    payloadHash: text("payload_hash").notNull(),
    reason: text("reason", { enum: ["malformed", "oversized"] }).notNull(),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("telegram_rejection_org_integration_hash_uq").on(t.organizationId, t.integrationId, t.payloadHash),
    index("telegram_rejection_org_received_idx").on(t.organizationId, t.receivedAt),
  ]
);

export const telegramMenuInstance = pgTable(
  "telegram_menu_instance",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
    chatId: text("chat_id").notNull(),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    generation: bigint("generation", { mode: "number" }).notNull(),
    fsbState: text("fsb_state").notNull(),
    fsmRevision: bigint("fsm_revision", { mode: "number" }).notNull().default(0),
    allowedActions: jsonb("allowed_actions").$type<string[]>().notNull(),
    status: text("status", { enum: ["pending", "delivered", "active", "consumed", "superseded", "failed"] }).notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at"),
    activatedAt: timestamp("activated_at"),
    consumedAt: timestamp("consumed_at"),
  },
  (t) => [
    uniqueIndex("telegram_menu_org_conv_generation_uq").on(t.organizationId, t.conversationId, t.generation),
    uniqueIndex("telegram_menu_org_conv_active_uq").on(t.organizationId, t.conversationId).where(sql`${t.status} = 'active'`),
    index("telegram_menu_org_chat_message_idx").on(t.organizationId, t.chatId, t.telegramMessageId),
  ]
);

export const telegramMenuAction = pgTable(
  "telegram_menu_action",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
    menuInstanceId: text("menu_instance_id").notNull().references(() => telegramMenuInstance.id, { onDelete: "cascade" }),
    receiptId: text("receipt_id").references(() => telegramWebhookReceipt.id, { onDelete: "cascade" }),
    callbackQueryId: text("callback_query_id").notNull(),
    telegramUpdateId: bigint("telegram_update_id", { mode: "number" }).notNull(),
    action: text("action").notNull(),
    status: text("status", { enum: ["pending", "processing", "processed", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at").notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at"),
    lastError: text("last_error"),
    ignoredReason: text("ignored_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (t) => [
    uniqueIndex("telegram_menu_action_org_callback_uq").on(t.organizationId, t.callbackQueryId),
    uniqueIndex("telegram_menu_action_org_receipt_uq").on(t.organizationId, t.receiptId),
    uniqueIndex("telegram_menu_action_org_instance_uq").on(t.organizationId, t.menuInstanceId),
    index("telegram_menu_action_org_status_available_idx").on(t.organizationId, t.status, t.availableAt),
  ]
);

export const telegramOutbox = pgTable(
  "telegram_outbox",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    integrationId: text("integration_id").notNull().references(() => telegramIntegration.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    kind: text("kind", { enum: ["message", "menu", "confirmation", "repricing", "cancellation", "recovery", "typing"] }).notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    dependsOnId: text("depends_on_id"),
    text: text("text"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    replyMarkup: jsonb("reply_markup").$type<Record<string, unknown>>(),
    fsmRevision: bigint("fsm_revision", { mode: "number" }).notNull(),
    status: text("status", { enum: ["pending", "sending", "delivered", "retryable_failed", "delivery_unknown", "failed", "superseded"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at").notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at"),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at"),
  },
  (t) => [
    uniqueIndex("telegram_outbox_org_idempotency_uq").on(t.organizationId, t.idempotencyKey),
    uniqueIndex("telegram_outbox_org_conv_sequence_uq").on(t.organizationId, t.conversationId, t.sequence),
    index("telegram_outbox_org_status_available_idx").on(t.organizationId, t.status, t.availableAt),
    index("telegram_outbox_org_conv_sequence_idx").on(t.organizationId, t.conversationId, t.sequence),
  ]
);

export const agentProfile = pgTable(
  "agent_profile",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    humanAvailable: boolean("human_available").notNull().default(true),
    name: text("name").notNull().default("Asistente"),
    tone: text("tone"),
    instructions: text("instructions"),
    escalationRules: text("escalation_rules"),
    greeting: text("greeting"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_profile_org_uq").on(t.organizationId)]
);

export const kbEntry = pgTable(
  "kb_entry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["qa", "block"] }).notNull(),
    question: text("question"),
    answer: text("answer"),
    content: text("content"),
    /** Vector RAG de 1536 dimensiones (Similitud Coseno <=>). */
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("kb_org_idx").on(t.organizationId)]
);

export const agentTestRun = pgTable(
  "agent_test_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["running", "done", "failed"] })
      .notNull()
      .default("running"),
    score: integer("score"),
    error: text("error"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    // Lock de concurrencia en BD: máximo 1 corrida activa por organización.
    uniqueIndex("test_run_org_running_uq")
      .on(t.organizationId)
      .where(sql`${t.status} = 'running'`),
    index("test_run_org_idx").on(t.organizationId, t.startedAt),
  ]
);

export const agentTestCase = pgTable(
  "agent_test_case",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentTestRun.id, { onDelete: "cascade" }),
    persona: text("persona").notNull(),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    transcript: jsonb("transcript"),
    veredicto: text("veredicto", { enum: ["verde", "amarillo", "rojo"] }),
    hallazgos: jsonb("hallazgos"),
    status: text("status", {
      enum: ["pending", "running", "done", "judge_failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("test_case_run_idx").on(t.runId)]
);

/* ============================================================
 * E-Commerce (Multi-tenant org-first: catálogos, carritos y pedidos)
 * ============================================================ */

export const category = pgTable(
  "category",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** Categoría de respaldo, gestionada exclusivamente por el dominio. */
    isGeneral: boolean("is_general").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("category_org_name_idx").on(t.organizationId, t.name),
    uniqueIndex("category_org_name_uq").on(t.organizationId, t.name),
    uniqueIndex("category_org_id_uq").on(t.organizationId, t.id),
  ]
);

export const product = pgTable(
  "product",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    categoryId: text("category_id").notNull(),
    sku: text("sku"),
    name: text("name").notNull(),
    description: text("description"),
    price: integer("price").notNull().default(0),
    stock: integer("stock").notNull().default(0),
    active: boolean("active").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("product_org_sku_uq").on(t.organizationId, t.sku),
    index("product_org_active_idx").on(t.organizationId, t.active),
  ]
);

export const commerceSettings = pgTable(
  "commerce_settings",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    maxUnitsPerProduct: integer("max_units_per_product").notNull().default(10),
    autoExpirationHours: integer("auto_expiration_hours").notNull().default(36),
    mercadopagoAccessToken: text("mercadopago_access_token"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("commerce_settings_max_units_positive", sql`${t.maxUnitsPerProduct} > 0`),
    check("commerce_settings_auto_expiration_positive", sql`${t.autoExpirationHours} > 0`),
  ]
);

export const cart = pgTable(
  "cart",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    reopenedFromOrderId: text("reopened_from_order_id"),
    items: jsonb("items")
      .$type<{ productId: string; quantity: number; unitPrice: number; name: string; presentation: string | null }[]>()
      .notNull()
      .default([]),
    status: text("status", { enum: ["active", "converted", "abandoned"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cart_org_conv_active_uq")
      .on(t.organizationId, t.conversationId)
      .where(sql`${t.status} = 'active'`),
    index("cart_org_conv_status_idx").on(
      t.organizationId,
      t.conversationId,
      t.status
    ),
  ]
);

export const commerceOrderCounter = pgTable(
  "commerce_order_counter",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    nextValue: bigint("next_value", { mode: "bigint" }).notNull().default(sql`1`),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [check("commerce_order_counter_next_positive", sql`${t.nextValue} > 0`)]
);

export const order = pgTable(
  "order",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    cartId: text("cart_id").references(() => cart.id, {
      onDelete: "set null",
    }),
    orderNumber: text("order_number").notNull(),
    items: jsonb("items")
      .$type<{ productId: string; quantity: number; unitPrice: number; name: string; presentation: string | null }[]>()
      .notNull()
      .default([]),
    totalAmount: integer("total_amount").notNull().default(0),
    isPaid: boolean("is_paid").notNull().default(false),
    status: text("status", {
      enum: ["pending", "confirmed", "processing", "pending_shipment", "shipped", "delivered", "paused", "completed", "cancelled"],
    })
      .notNull()
      .default("pending"),
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("order_org_number_uq").on(t.organizationId, t.orderNumber),
    index("order_org_status_idx").on(t.organizationId, t.status),
    index("order_org_contact_status_idx").on(
      t.organizationId,
      t.contactId,
      t.status
    ),
  ]
);

export const payment = pgTable(
  "payment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => order.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["mercadopago", "stripe", "transfer"] }).notNull(),
    externalId: text("external_id"),
    amount: integer("amount").notNull(),
    status: text("status", {
      enum: ["pending", "paid", "failed", "refunded"],
    }).notNull().default("pending"),
    paymentUrl: text("payment_url"),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("payment_org_order_idx").on(t.organizationId, t.orderId),
    uniqueIndex("payment_org_external_id_uq").on(t.organizationId, t.provider, t.externalId).where(sql`${t.externalId} IS NOT NULL`),
  ]
);
