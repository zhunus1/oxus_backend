import type { ApiResponseSchemaHost } from "@nestjs/swagger";
type SchemaObject = ApiResponseSchemaHost["schema"];
import { ContractStatus, ProcessStep, SubscriptionTier } from "generated/prisma/enums";
import { USER_JOURNEY_EVENT_TYPES } from "src/modules/user-journey/user-journey.constants";

const str: SchemaObject = { type: "string" };
const num: SchemaObject = { type: "number" };
const integer: SchemaObject = { type: "integer" };
const bool: SchemaObject = { type: "boolean" };
const date: SchemaObject = { type: "string", format: "date-time" };
const nullable = (schema: SchemaObject): SchemaObject => ({ ...schema, nullable: true });
const array = (items: SchemaObject): SchemaObject => ({ type: "array", items });
const object = (properties: Record<string, SchemaObject>, required = Object.keys(properties)): SchemaObject => ({ type: "object", properties, required });
const json: SchemaObject = { type: "object", additionalProperties: true, nullable: true };
const person = object({ id: integer, firstname: str, lastname: str, email: str });
const page = { total: integer, page: integer, limit: integer, totalPages: integer };
const legacyPage = { total: integer, page: integer, totalPages: integer };

export const installmentResponse = object({
  id: str,
  contractId: str,
  number: integer,
  amount: { type: "string", description: "Decimal serialized as a string in contract responses" },
  dueDate: date,
  paidAt: nullable(date),
  confirmedAt: nullable(date),
  confirmedByUserId: nullable(integer),
});
export const contractResponse = object(
  {
    id: str,
    studentId: integer,
    contractNumber: str,
    status: { type: "string", enum: Object.values(ContractStatus) },
    subscriptionTier: { type: "string", enum: Object.values(SubscriptionTier) },
    price: num,
    currency: str,
    paymentType: { type: "string", enum: ["FULL", "INSTALLMENT"], nullable: true },
    installmentCount: nullable(integer),
    manualConfirmedAt: nullable(date),
    studentSignedAt: nullable(date),
    expertSignedAt: nullable(date),
    paidAt: nullable(date),
    signedByUserId: nullable(integer),
    scanFileKey: nullable(str),
    partyDetails: json,
    createdAt: date,
    updatedAt: date,
    installments: array(installmentResponse),
  },
  ["id", "studentId", "status", "subscriptionTier", "price", "currency"],
);
export const contractListResponse = object({ data: array(contractResponse), ...page });
export const draftResponse = object({
  leadId: integer,
  data: { type: "object", additionalProperties: true, description: "Prepared identity, parent identity and validated commercial terms" },
  signedAt: nullable(date),
  createdAt: date,
  updatedAt: date,
});
const leadResponse = object({ id: integer, status: str, contractId: nullable(str), statusChangedAt: date }, ["id", "status", "contractId"]);
export const leadPrepareResponse = object({ lead: leadResponse, contract: nullable(contractResponse), draft: nullable(draftResponse), invitationRequired: bool });
export const leadSignatureResponse = object({ lead: leadResponse, draft: draftResponse });
export const leadConfirmResponse = object({ lead: leadResponse, contract: contractResponse, invitationRequired: bool });
export const leadDetailResponse = object({
  ...(leadResponse.properties as Record<string, SchemaObject>),
  contract: nullable(contractResponse),
  contractDraft: nullable(draftResponse),
});
export const scheduleResponse = object({
  paymentType: str,
  installmentCount: integer,
  price: num,
  currency: str,
  installments: array(object({ number: integer, amount: { type: "string" }, dueDate: date })),
});
export const manualConflictResponse = object(
  {
    statusCode: { type: "integer", example: 409 },
    message: str,
    code: {
      type: "string",
      description: "Present for machine-readable conflicts; other business conflicts may contain message only",
      enum: ["HISTORICAL_BENEFITS_REVIEW_REQUIRED", "EXISTING_STUDENT_CONFIRMATION_REQUIRED", "MANUAL_SIGNATURE_REQUIRED"],
    },
    contractId: str,
  },
  ["message"],
);
export const onlineSigningConflict = object({ code: { type: "string", enum: ["MANUAL_SIGNATURE_REQUIRED"] }, message: str });

const currencyAmounts = { currency: str, totalSignedAmount: num, totalPaidAmount: num, signedUnpaidAmount: num };
const money = {
  currency: nullable(str),
  totalSignedAmount: nullable(num),
  totalPaidAmount: nullable(num),
  signedUnpaidAmount: nullable(num),
  byCurrency: array(object(currencyAmounts)),
};
export const financeContractResponse = object({
  id: str,
  contractNumber: str,
  student: person,
  expert: nullable(person),
  amount: num,
  paidAmount: num,
  remainingAmount: num,
  currency: str,
  subscriptionTier: str,
  status: { type: "string", enum: Object.values(ContractStatus) },
  studentSignedAt: nullable(date),
  expertSignedAt: nullable(date),
  paidAt: nullable(date),
  createdAt: date,
});
export const financeListResponse = object({ data: array(financeContractResponse), ...legacyPage });
export const financeSummaryResponse = object({
  ...money,
  totalSignedContracts: integer,
  paidContractsCount: integer,
  totalContracts: integer,
  expertsWithContracts: integer,
  countByStatus: { type: "object", additionalProperties: integer },
  expertOptions: array(person),
  earningsByExpert: array(object({ ...(person.properties as Record<string, SchemaObject>), ...money, contractCount: integer, paidContractCount: integer })),
});
export const earningsResponse = object({
  expert: person,
  totals: object({
    allContracts: integer,
    currency: nullable(str),
    paidAmount: nullable(num),
    signedUnpaidAmount: nullable(num),
    byCurrency: array(object({ currency: str, paidAmount: num, signedUnpaidAmount: num })),
  }),
  contracts: array(financeContractResponse),
  ...page,
});
const event = object({
  id: integer,
  eventType: { type: "string", description: `Known event types: ${USER_JOURNEY_EVENT_TYPES.join(", ")}. Historical/custom event types may also occur.` },
  eventData: json,
  createdAt: { ...date, description: "Storage timestamp" },
  occurredAt: { ...date, description: "Business event timestamp; legacy null falls back to createdAt" },
});
export const analyticsEventsResponse = object({
  data: array(object({ ...(event.properties as Record<string, SchemaObject>), studentId: integer, studentName: str })),
  ...legacyPage,
});
export const journeyResponse = object({
  studentId: integer,
  studentName: str,
  currentStep: { type: "string", enum: Object.values(ProcessStep) },
  registeredAt: date,
  events: array(event),
  stageDurations: array(object({ stage: str, labelRu: str, durationMs: nullable(num), durationDays: nullable(num) })),
});
export const analyticsSummaryResponse = object({
  totalStudents: integer,
  averageDaysToProgramSelection: nullable(num),
  averageDaysToPayment: nullable(num),
  conversionToPaymentPercent: num,
  lostLeads: { ...integer, description: "Same registration cohort; age >= 7 days, DISCOVERY + NONE, no confirmed payment/conversion evidence" },
  paymentsCompletedCount: integer,
});
export const funnelResponse = array(object({ stage: str, count: integer, conversionRate: num }, ["stage", "count"]));

export const scanUploadResponse = object({ contractId: str, hasScan: bool });
export const scanRequest = object({
  file: { type: "string", format: "binary", description: "PDF, JPEG or PNG, maximum 10485760 bytes (10 MiB); detected content must match MIME" },
});
export const freedomCallbackBody: SchemaObject = {
  type: "object",
  additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }] },
  description:
    "Provider scalar payload: preserve every raw signed field, including extensions. No DTO coercion. bankcard requires pg_captured=1. Authenticated by provider signature, not bearer.",
  properties: Object.fromEntries(
    ["pg_order_id", "pg_payment_id", "pg_amount", "pg_currency", "pg_result", "pg_payment_method", "pg_testing_mode", "pg_captured", "pg_merchant_id", "pg_salt", "pg_sig"].map(
      key => [key, str],
    ),
  ),
  required: ["pg_order_id", "pg_payment_id", "pg_amount", "pg_currency", "pg_result", "pg_payment_method", "pg_testing_mode", "pg_salt", "pg_sig"],
};
