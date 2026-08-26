-- CreateTable
CREATE TABLE "CollabMeeting" (
    "id" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollabMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollabMeetingInvitee" (
    "id" SERIAL NOT NULL,
    "collabMeetingId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "CollabMeetingInvitee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollabMeetingNote" (
    "id" SERIAL NOT NULL,
    "collabMeetingId" TEXT NOT NULL,
    "authorId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollabMeetingNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollabMeetingTodo" (
    "id" SERIAL NOT NULL,
    "collabMeetingId" TEXT NOT NULL,
    "createdById" INTEGER NOT NULL,
    "assigneeId" INTEGER,
    "text" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollabMeetingTodo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollabMeeting_roomName_key" ON "CollabMeeting"("roomName");

-- CreateIndex
CREATE INDEX "CollabMeeting_createdById_idx" ON "CollabMeeting"("createdById");

-- CreateIndex
CREATE INDEX "CollabMeeting_startTime_idx" ON "CollabMeeting"("startTime");

-- CreateIndex
CREATE INDEX "CollabMeetingInvitee_userId_idx" ON "CollabMeetingInvitee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CollabMeetingInvitee_collabMeetingId_userId_key" ON "CollabMeetingInvitee"("collabMeetingId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CollabMeetingNote_collabMeetingId_authorId_key" ON "CollabMeetingNote"("collabMeetingId", "authorId");

-- CreateIndex
CREATE INDEX "CollabMeetingTodo_collabMeetingId_idx" ON "CollabMeetingTodo"("collabMeetingId");

-- AddForeignKey
ALTER TABLE "CollabMeeting" ADD CONSTRAINT "CollabMeeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabMeetingInvitee" ADD CONSTRAINT "CollabMeetingInvitee_collabMeetingId_fkey" FOREIGN KEY ("collabMeetingId") REFERENCES "CollabMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabMeetingInvitee" ADD CONSTRAINT "CollabMeetingInvitee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabMeetingNote" ADD CONSTRAINT "CollabMeetingNote_collabMeetingId_fkey" FOREIGN KEY ("collabMeetingId") REFERENCES "CollabMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabMeetingNote" ADD CONSTRAINT "CollabMeetingNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabMeetingTodo" ADD CONSTRAINT "CollabMeetingTodo_collabMeetingId_fkey" FOREIGN KEY ("collabMeetingId") REFERENCES "CollabMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabMeetingTodo" ADD CONSTRAINT "CollabMeetingTodo_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabMeetingTodo" ADD CONSTRAINT "CollabMeetingTodo_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
