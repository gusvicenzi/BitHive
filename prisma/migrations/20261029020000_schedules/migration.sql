CREATE TABLE "Schedule" (
 "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "timeZone" TEXT NOT NULL,
 "points" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false, "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "ScheduleMember" (
 "id" TEXT NOT NULL PRIMARY KEY, "scheduleId" TEXT NOT NULL, "deviceId" TEXT NOT NULL,
 "activeDeviceId" TEXT, "assignments" TEXT NOT NULL, "acknowledgments" TEXT NOT NULL DEFAULT '{}', "overrideUntil" DATETIME,
 CONSTRAINT "ScheduleMember_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ScheduleMember_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ScheduleMember_activeDeviceId_key" ON "ScheduleMember"("activeDeviceId");
CREATE UNIQUE INDEX "ScheduleMember_scheduleId_deviceId_key" ON "ScheduleMember"("scheduleId", "deviceId");
CREATE TABLE "ScheduleExecution" (
 "id" TEXT NOT NULL PRIMARY KEY, "scheduleId" TEXT, "deviceId" TEXT NOT NULL,
 "revision" INTEGER NOT NULL, "occurrence" TEXT NOT NULL, "pointId" TEXT NOT NULL, "scheduleName" TEXT NOT NULL, "periodName" TEXT NOT NULL, "profileName" TEXT NOT NULL,
 "settings" TEXT NOT NULL, "status" TEXT NOT NULL, "reason" TEXT, "attempted" BOOLEAN NOT NULL DEFAULT false,
 "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ScheduleExecution_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
 CONSTRAINT "ScheduleExecution_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ScheduleExecution_scheduleId_deviceId_revision_occurrence_key" ON "ScheduleExecution"("scheduleId", "deviceId", "revision", "occurrence");
CREATE INDEX "ScheduleExecution_deviceId_timestamp_idx" ON "ScheduleExecution"("deviceId", "timestamp");
CREATE INDEX "ScheduleExecution_timestamp_idx" ON "ScheduleExecution"("timestamp");
