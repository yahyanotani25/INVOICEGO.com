-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "public"."PlatformRole" AS ENUM ('NONE', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'AUDITOR');

-- CreateEnum
CREATE TYPE "public"."MemberRole" AS ENUM ('OWNER', 'ADMIN', 'ACCOUNTANT', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "public"."SessionKind" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."TokenPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD', 'ADMIN_INVITE');

-- CreateEnum
CREATE TYPE "public"."WhitelistStatus" AS ENUM ('NOT_SUBMITTED', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."FbrEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "public"."CredentialStatus" AS ENUM ('UNTESTED', 'OK', 'UNAUTHORIZED', 'ERROR');

-- CreateEnum
CREATE TYPE "public"."RegistrationType" AS ENUM ('REGISTERED', 'UNREGISTERED');

-- CreateEnum
CREATE TYPE "public"."VerificationResult" AS ENUM ('NOT_CHECKED', 'REGISTERED', 'UNREGISTERED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "public"."InvoiceType" AS ENUM ('SALE_INVOICE', 'DEBIT_NOTE');

-- CreateEnum
CREATE TYPE "public"."InvoiceStatus" AS ENUM ('DRAFT', 'VALIDATING', 'VALIDATED', 'VALIDATION_FAILED', 'SUBMITTING', 'ACCEPTED', 'REJECTED', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "public"."InvoiceSource" AS ENUM ('MANUAL', 'EXCEL', 'SANDBOX_WORKSPACE', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "public"."SnapshotKind" AS ENUM ('VALIDATED', 'SUBMITTED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "public"."AttemptOperation" AS ENUM ('VALIDATE', 'POST', 'CONNECTION_TEST', 'REG_TYPE_LOOKUP', 'STATL_LOOKUP', 'REFERENCE');

-- CreateEnum
CREATE TYPE "public"."AttemptOutcome" AS ENUM ('PENDING', 'VALID', 'INVALID', 'AUTH_ERROR', 'HTTP_ERROR', 'NOT_SENT', 'UNCERTAIN', 'BAD_RESPONSE', 'OK');

-- CreateEnum
CREATE TYPE "public"."ScenarioStatus" AS ENUM ('NOT_STARTED', 'FAILED', 'PASSED');

-- CreateEnum
CREATE TYPE "public"."TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'AWAITING_USER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."TicketPriority" AS ENUM ('HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "public"."TicketCategory" AS ENUM ('COMPLAINT', 'MESSAGE', 'TECHNICAL');

-- CreateEnum
CREATE TYPE "public"."QueryType" AS ENUM ('INTEGRATION', 'POST_INTEGRATION');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "emailVerifiedAt" TIMESTAMP(3),
    "platformRole" "public"."PlatformRole" NOT NULL DEFAULT 'NONE',
    "totpSecretEnc" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmailToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "public"."TokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "public"."SessionKind" NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "activeBusinessId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoginEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "kind" "public"."SessionKind" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ntnCnic" TEXT NOT NULL,
    "strn" TEXT,
    "address" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "businessActivities" TEXT[],
    "sector" TEXT NOT NULL,
    "retailerRegistered" BOOLEAN NOT NULL DEFAULT false,
    "officialScenarioIds" TEXT[],
    "logoMime" TEXT,
    "logoData" BYTEA,
    "productionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "productionEnabledAt" TIMESTAMP(3),
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "nextInvoiceSeq" INTEGER NOT NULL DEFAULT 1,
    "furtherTaxHelperRate" DECIMAL(9,4),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "role" "public"."MemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OnboardingProfile" (
    "businessId" TEXT NOT NULL,
    "integratorChoice" TEXT,
    "otherIntegratorName" TEXT,
    "technicalContactName" TEXT,
    "technicalContactMobile" TEXT,
    "technicalContactEmail" TEXT,
    "erpProvider" TEXT,
    "softwareType" TEXT,
    "softwareVersion" TEXT,
    "crmUserEmail" TEXT,
    "hostingCompany" TEXT,
    "hostingCountry" TEXT,
    "whitelistIps" TEXT[],
    "whitelistStatus" "public"."WhitelistStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "whitelistNotes" TEXT,
    "whitelistUpdatedAt" TIMESTAMP(3),
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingProfile_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "public"."FbrCredential" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "environment" "public"."FbrEnvironment" NOT NULL,
    "postUrl" TEXT NOT NULL,
    "validateUrl" TEXT NOT NULL,
    "tokenEnc" TEXT,
    "tokenLast4" TEXT,
    "tokenUpdatedAt" TIMESTAMP(3),
    "status" "public"."CredentialStatus" NOT NULL DEFAULT 'UNTESTED',
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckMessage" TEXT,
    "lastCheckHttpStatus" INTEGER,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FbrCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Customer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ntnCnic" TEXT,
    "strn" TEXT,
    "province" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "registrationType" "public"."RegistrationType" NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "category" TEXT,
    "verifiedResult" "public"."VerificationResult" NOT NULL DEFAULT 'NOT_CHECKED',
    "verifiedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Product" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hsCode" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "saleType" TEXT NOT NULL,
    "rate" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "retailPrice" DECIMAL(18,4),
    "sroScheduleNo" TEXT,
    "sroItemSerialNo" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HsCode" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "fullDescription" TEXT NOT NULL,
    "chapter" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceLines" INTEGER[],
    "importRunId" TEXT,

    CONSTRAINT "HsCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "public"."HsCodeAlternate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceLine" TEXT NOT NULL,

    CONSTRAINT "HsCodeAlternate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DataImportRun" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "sourceFiles" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DataImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReferenceCache" (
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedById" TEXT,

    CONSTRAINT "ReferenceCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."ScenarioDefinition" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "saleTypeLabel" TEXT NOT NULL,
    "saleTypeApi" TEXT NOT NULL,
    "retailerOnly" BOOLEAN NOT NULL DEFAULT false,
    "purchaseType" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "ScenarioDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScenarioTemplate" (
    "scenarioId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "json" JSONB NOT NULL,
    "anomalies" JSONB NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "ScenarioTemplate_pkey" PRIMARY KEY ("scenarioId")
);

-- CreateTable
CREATE TABLE "public"."ApplicabilityRule" (
    "sr" INTEGER NOT NULL,
    "businessActivity" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "scenarioIdsRaw" TEXT[],
    "rawText" TEXT NOT NULL,
    "sourcePage" INTEGER NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "ApplicabilityRule_pkey" PRIMARY KEY ("sr")
);

-- CreateTable
CREATE TABLE "public"."SourceAnomaly" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" JSONB NOT NULL,

    CONSTRAINT "SourceAnomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ErrorCode" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "messageDesc" TEXT NOT NULL,
    "briefMsgDesc" TEXT NOT NULL,
    "friendly" TEXT NOT NULL,
    "field" TEXT,
    "action" TEXT NOT NULL,
    "variants" JSONB NOT NULL,
    "occurrences" INTEGER NOT NULL,
    "sourcePages" INTEGER[],
    "source" TEXT NOT NULL,

    CONSTRAINT "ErrorCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Invoice" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "environment" "public"."FbrEnvironment" NOT NULL,
    "internalNumber" TEXT NOT NULL,
    "invoiceType" "public"."InvoiceType" NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "invoiceTime" TEXT NOT NULL,
    "paymentMode" TEXT,
    "invoiceRefNo" TEXT NOT NULL DEFAULT '',
    "scenarioId" TEXT,
    "sellerNtnCnic" TEXT NOT NULL,
    "sellerBusinessName" TEXT NOT NULL,
    "sellerProvince" TEXT NOT NULL,
    "sellerAddress" TEXT NOT NULL,
    "buyerNtnCnic" TEXT NOT NULL DEFAULT '',
    "buyerBusinessName" TEXT NOT NULL,
    "buyerProvince" TEXT NOT NULL,
    "buyerAddress" TEXT NOT NULL,
    "buyerRegistrationType" "public"."RegistrationType",
    "customerId" TEXT,
    "status" "public"."InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "public"."InvoiceSource" NOT NULL DEFAULT 'MANUAL',
    "importJobId" TEXT,
    "importRef" TEXT,
    "autoCalc" BOOLEAN NOT NULL DEFAULT true,
    "totalValueExclST" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalSalesTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalFurtherTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalExtraTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalFed" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalWithheld" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalDiscount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netReceivable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payloadHash" TEXT,
    "validatedHash" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "submitLockToken" TEXT,
    "submitLockedAt" TIMESTAMP(3),
    "fbrInvoiceNumber" TEXT,
    "fbrDated" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedViaReconcile" BOOLEAN NOT NULL DEFAULT false,
    "reconciliationNote" TEXT,
    "buyerCheckResult" "public"."VerificationResult" NOT NULL DEFAULT 'NOT_CHECKED',
    "buyerCheckAt" TIMESTAMP(3),
    "buyerCheckId" TEXT,
    "rawTemplateDiff" JSONB,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT,
    "saleType" TEXT NOT NULL,
    "hsCode" TEXT NOT NULL,
    "productDescription" TEXT NOT NULL,
    "rate" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "valueSalesExcludingST" DECIMAL(18,2) NOT NULL,
    "salesTaxApplicable" DECIMAL(18,2) NOT NULL,
    "retailPricePerUnit" DECIMAL(18,4),
    "fixedNotifiedValueOrRetailPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "extraTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "extraTaxEmpty" BOOLEAN NOT NULL DEFAULT false,
    "furtherTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fedPayable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "salesTaxWithheldAtSource" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sroScheduleNo" TEXT NOT NULL DEFAULT '',
    "sroItemSerialNo" TEXT NOT NULL DEFAULT '',
    "totalValues" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fbrItemInvoiceNo" TEXT,
    "fbrItemStatusCode" TEXT,
    "fbrItemErrorCode" TEXT,
    "fbrItemError" TEXT,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InvoiceSnapshot" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "public"."SnapshotKind" NOT NULL,
    "payloadText" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "invoiceData" JSONB NOT NULL,
    "attemptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FbrAttempt" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "environment" "public"."FbrEnvironment" NOT NULL,
    "operation" "public"."AttemptOperation" NOT NULL,
    "url" TEXT NOT NULL,
    "requestBody" TEXT,
    "requestHash" TEXT,
    "httpStatus" INTEGER,
    "responseBody" TEXT,
    "responseJson" JSONB,
    "outcome" "public"."AttemptOutcome" NOT NULL DEFAULT 'PENDING',
    "fbrInvoiceNo" TEXT,
    "errors" JSONB,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "scenarioId" TEXT,
    "initiatedById" TEXT,
    "initiatedKind" TEXT,
    "retryOfId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "FbrAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BuyerVerification" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "registrationNo" TEXT NOT NULL,
    "result" "public"."VerificationResult" NOT NULL,
    "statusCode" TEXT,
    "rawType" TEXT,
    "httpStatus" INTEGER,
    "message" TEXT,
    "attemptId" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScenarioProgress" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "status" "public"."ScenarioStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastOutcome" TEXT,
    "passedAt" TIMESTAMP(3),
    "passedInvoiceId" TEXT,
    "passedFbrNumber" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScenarioProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ImportJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "environment" "public"."FbrEnvironment" NOT NULL,
    "filename" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PARSED',
    "totalInvoices" INTEGER NOT NULL DEFAULT 0,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "fileErrors" JSONB NOT NULL DEFAULT '[]',
    "counts" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ImportInvoice" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "importRef" TEXT NOT NULL,
    "rowNumbers" INTEGER[],
    "status" TEXT NOT NULL,
    "invoiceId" TEXT,
    "data" JSONB NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "fbrResult" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "businessId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupportTicket" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "public"."TicketCategory" NOT NULL,
    "queryType" "public"."QueryType" NOT NULL,
    "priority" "public"."TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "public"."TicketStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorIsAdmin" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TicketAttachment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "businessId" TEXT,
    "audience" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Announcement" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorKind" TEXT NOT NULL,
    "businessId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."BackupRecord" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fileName" TEXT,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "error" TEXT,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailToken_tokenHash_key" ON "public"."EmailToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailToken_userId_purpose_idx" ON "public"."EmailToken"("userId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "public"."Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_kind_idx" ON "public"."Session"("userId", "kind");

-- CreateIndex
CREATE INDEX "LoginEvent_userId_createdAt_idx" ON "public"."LoginEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_createdAt_idx" ON "public"."LoginEvent"("createdAt");

-- CreateIndex
CREATE INDEX "Membership_businessId_idx" ON "public"."Membership"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_businessId_key" ON "public"."Membership"("userId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "FbrCredential_businessId_environment_key" ON "public"."FbrCredential"("businessId", "environment");

-- CreateIndex
CREATE INDEX "Customer_businessId_name_idx" ON "public"."Customer"("businessId", "name");

-- CreateIndex
CREATE INDEX "Customer_businessId_ntnCnic_idx" ON "public"."Customer"("businessId", "ntnCnic");

-- CreateIndex
CREATE INDEX "Product_businessId_sku_idx" ON "public"."Product"("businessId", "sku");

-- CreateIndex
CREATE INDEX "Product_businessId_hsCode_idx" ON "public"."Product"("businessId", "hsCode");

-- CreateIndex
CREATE INDEX "HsCode_heading_idx" ON "public"."HsCode"("heading");

-- CreateIndex
CREATE INDEX "HsCodeAlternate_code_idx" ON "public"."HsCodeAlternate"("code");

-- CreateIndex
CREATE INDEX "ApplicabilityRule_businessActivity_sector_idx" ON "public"."ApplicabilityRule"("businessActivity", "sector");

-- CreateIndex
CREATE INDEX "ErrorCode_code_idx" ON "public"."ErrorCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorCode_category_code_key" ON "public"."ErrorCode"("category", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_fbrInvoiceNumber_key" ON "public"."Invoice"("fbrInvoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_businessId_environment_status_idx" ON "public"."Invoice"("businessId", "environment", "status");

-- CreateIndex
CREATE INDEX "Invoice_businessId_invoiceDate_idx" ON "public"."Invoice"("businessId", "invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "public"."Invoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_businessId_internalNumber_key" ON "public"."Invoice"("businessId", "internalNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceItem_invoiceId_lineNo_key" ON "public"."InvoiceItem"("invoiceId", "lineNo");

-- CreateIndex
CREATE INDEX "InvoiceSnapshot_invoiceId_idx" ON "public"."InvoiceSnapshot"("invoiceId");

-- CreateIndex
CREATE INDEX "FbrAttempt_businessId_startedAt_idx" ON "public"."FbrAttempt"("businessId", "startedAt");

-- CreateIndex
CREATE INDEX "FbrAttempt_invoiceId_idx" ON "public"."FbrAttempt"("invoiceId");

-- CreateIndex
CREATE INDEX "FbrAttempt_outcome_startedAt_idx" ON "public"."FbrAttempt"("outcome", "startedAt");

-- CreateIndex
CREATE INDEX "FbrAttempt_businessId_scenarioId_idx" ON "public"."FbrAttempt"("businessId", "scenarioId");

-- CreateIndex
CREATE INDEX "BuyerVerification_businessId_registrationNo_checkedAt_idx" ON "public"."BuyerVerification"("businessId", "registrationNo", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioProgress_businessId_scenarioId_key" ON "public"."ScenarioProgress"("businessId", "scenarioId");

-- CreateIndex
CREATE INDEX "ImportJob_businessId_createdAt_idx" ON "public"."ImportJob"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportInvoice_jobId_importRef_key" ON "public"."ImportInvoice"("jobId", "importRef");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "public"."Job"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_number_key" ON "public"."SupportTicket"("number");

-- CreateIndex
CREATE INDEX "SupportTicket_businessId_createdAt_idx" ON "public"."SupportTicket"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_status_idx" ON "public"."SupportTicket"("status");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "public"."Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_audience_createdAt_idx" ON "public"."Notification"("audience", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "public"."AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_createdAt_idx" ON "public"."AuditLog"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "public"."AuditLog"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."EmailToken" ADD CONSTRAINT "EmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingProfile" ADD CONSTRAINT "OnboardingProfile_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FbrCredential" ADD CONSTRAINT "FbrCredential_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Customer" ADD CONSTRAINT "Customer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HsCodeAlternate" ADD CONSTRAINT "HsCodeAlternate_code_fkey" FOREIGN KEY ("code") REFERENCES "public"."HsCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Invoice" ADD CONSTRAINT "Invoice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvoiceSnapshot" ADD CONSTRAINT "InvoiceSnapshot_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FbrAttempt" ADD CONSTRAINT "FbrAttempt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ImportInvoice" ADD CONSTRAINT "ImportInvoice_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "public"."SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TicketAttachment" ADD CONSTRAINT "TicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "public"."SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
