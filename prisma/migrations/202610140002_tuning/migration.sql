-- CreateTable
CREATE TABLE "TuningRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "activeSlot" INTEGER,
    "config" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TuningRun_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TuningAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "candidateId" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "summary" TEXT,
    "auditId" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "TuningAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TuningRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TuningSample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "attemptId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "phase" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    CONSTRAINT "TuningSample_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "TuningAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TuningCheckpoint" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "profile" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "auditId" INTEGER,
    CONSTRAINT "TuningCheckpoint_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TuningRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TuningRun_activeSlot_key" ON "TuningRun"("activeSlot");

-- CreateIndex
CREATE INDEX "TuningRun_deviceId_createdAt_idx" ON "TuningRun"("deviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TuningRun_deviceId_requestKey_key" ON "TuningRun"("deviceId", "requestKey");

-- CreateIndex
CREATE INDEX "TuningAttempt_runId_startedAt_idx" ON "TuningAttempt"("runId", "startedAt");

-- CreateIndex
CREATE INDEX "TuningSample_attemptId_timestamp_idx" ON "TuningSample"("attemptId", "timestamp");

-- CreateIndex
CREATE INDEX "TuningCheckpoint_runId_timestamp_idx" ON "TuningCheckpoint"("runId", "timestamp");

