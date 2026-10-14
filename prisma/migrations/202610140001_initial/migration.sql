PRAGMA foreign_keys=ON;
CREATE TABLE "Device" (
 "id" TEXT NOT NULL PRIMARY KEY, "address" TEXT NOT NULL, "name" TEXT NOT NULL,
 "demo" BOOLEAN NOT NULL DEFAULT false, "snapshot" TEXT NOT NULL DEFAULT '{}',
 "lastSeen" DATETIME, "failures" INTEGER NOT NULL DEFAULT 0,
 "nextPoll" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Device_address_key" ON "Device"("address");
CREATE INDEX "Device_nextPoll_idx" ON "Device"("nextPoll");
CREATE TABLE "Metric" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "deviceId" TEXT NOT NULL,
 "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "hashRate" REAL, "power" REAL, "temp" REAL, "vrTemp" REAL, "errorRate" REAL,
 "accepted" REAL, "rejected" REAL,
 CONSTRAINT "Metric_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Metric_deviceId_timestamp_idx" ON "Metric"("deviceId", "timestamp");
CREATE INDEX "Metric_timestamp_idx" ON "Metric"("timestamp");
CREATE TABLE "Event" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "deviceId" TEXT NOT NULL,
 "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "kind" TEXT NOT NULL,
 CONSTRAINT "Event_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Event_deviceId_timestamp_idx" ON "Event"("deviceId", "timestamp");
CREATE INDEX "Event_timestamp_idx" ON "Event"("timestamp");
CREATE TABLE "ConfigChange" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "deviceId" TEXT NOT NULL,
 "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "before" TEXT NOT NULL, "requested" TEXT NOT NULL, "after" TEXT, "result" TEXT NOT NULL,
 CONSTRAINT "ConfigChange_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConfigChange_deviceId_timestamp_idx" ON "ConfigChange"("deviceId", "timestamp");
CREATE INDEX "ConfigChange_timestamp_idx" ON "ConfigChange"("timestamp");
CREATE TABLE "Profile" (
 "id" TEXT NOT NULL PRIMARY KEY, "deviceId" TEXT NOT NULL, "name" TEXT NOT NULL,
 "settings" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Profile_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Profile_deviceId_createdAt_idx" ON "Profile"("deviceId", "createdAt");
