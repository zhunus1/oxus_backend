import { ProcessStep } from "generated/prisma/client";

/**
 * CRM-лейблы админки. В БД — `StudentPortrait.currentStep` (`ProcessStep`).
 *
 * Линейное соответствие этапов:
 * NEW_LEAD → DISCOVERY
 * PROFILE_FILLED → UNI_SELECTION
 * PROGRAMS_SELECTED → DOC_PREPARATION
 * DOCUMENTS_UPLOADED → APPLYING
 * CONTRACT_SIGNED → VISA_SUPPORT
 * PAYMENT_RECEIVED / COMPLETED → ENROLLED
 *
 * `PAYMENT_RECEIVED` и `COMPLETED` делят один `ProcessStep.ENROLLED`:
 * - отображение: при `overallProgress >= 100` → бейдж COMPLETED, иначе → PAYMENT_RECEIVED;
 * - PATCH `COMPLETED` выставляет ENROLLED и `overallProgress: 100`;
 * - PATCH `PAYMENT_RECEIVED` выставляет только ENROLLED.
 *
 * `GAP_YEAR` в БД отображаем как COMPLETED (завершённый/архивный цикл в CRM-UI).
 */
export const CRM_STUDENT_STATUSES = ["NEW_LEAD", "PROFILE_FILLED", "PROGRAMS_SELECTED", "DOCUMENTS_UPLOADED", "CONTRACT_SIGNED", "PAYMENT_RECEIVED", "COMPLETED"] as const;

export type CrmStudentStatus = (typeof CRM_STUDENT_STATUSES)[number];

const CRM_TO_STEP: Record<CrmStudentStatus, ProcessStep> = {
  NEW_LEAD: ProcessStep.DISCOVERY,
  PROFILE_FILLED: ProcessStep.UNI_SELECTION,
  PROGRAMS_SELECTED: ProcessStep.DOC_PREPARATION,
  DOCUMENTS_UPLOADED: ProcessStep.APPLYING,
  CONTRACT_SIGNED: ProcessStep.VISA_SUPPORT,
  PAYMENT_RECEIVED: ProcessStep.ENROLLED,
  COMPLETED: ProcessStep.ENROLLED,
};

export function crmStatusToProcessStep(status: string): ProcessStep {
  const key = status.toUpperCase() as CrmStudentStatus;
  const step = CRM_TO_STEP[key];
  if (step === undefined) {
    throw new Error(`Invalid CRM status: ${status}`);
  }
  return step;
}

/** Отображаемый CRM-статус с учётом прогресса для различения PAYMENT_RECEIVED / COMPLETED на ENROLLED. */
export function processStepToCrmStatus(step: ProcessStep, portrait?: { overallProgress: number | null } | null): CrmStudentStatus {
  if (step === ProcessStep.ENROLLED) {
    const p = portrait?.overallProgress ?? 0;
    return p >= 100 ? "COMPLETED" : "PAYMENT_RECEIVED";
  }
  if (step === ProcessStep.GAP_YEAR) {
    return "COMPLETED";
  }
  switch (step) {
    case ProcessStep.DISCOVERY:
      return "NEW_LEAD";
    case ProcessStep.UNI_SELECTION:
      return "PROFILE_FILLED";
    case ProcessStep.DOC_PREPARATION:
      return "PROGRAMS_SELECTED";
    case ProcessStep.APPLYING:
      return "DOCUMENTS_UPLOADED";
    case ProcessStep.VISA_SUPPORT:
      return "CONTRACT_SIGNED";
    default:
      return "NEW_LEAD";
  }
}

export function isCrmStudentStatus(s: string): s is CrmStudentStatus {
  return (CRM_STUDENT_STATUSES as readonly string[]).includes(s);
}

export function parseCrmStudentStatus(s: string): CrmStudentStatus {
  const u = s.toUpperCase();
  if (!isCrmStudentStatus(u)) {
    throw new Error(`Invalid CRM status: ${s}`);
  }
  return u;
}
