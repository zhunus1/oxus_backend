import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { SubscriptionTier } from "generated/prisma/enums";
import { BaseRepository } from "src/database/prisma.repository";
import { PortraitEntity } from "../api/dto/portrait.entity";
import { CreatePortraitTestDto } from "../api/dto/create-portrait-test.dto";
import { UpdatePortraitTestDto } from "../api/dto/update-portrait-test.dto";
import { AddPortraitLanguageDto } from "../api/dto/add-portrait-language.dto";
import messages from "src/configs/messages";

@Injectable()
export class StudentPortraitRepository extends BaseRepository {
  private readonly portraitInclude = {
    languages: {
      include: { language: true },
    },
    tests: true,
    targetCountries: { include: { country: true } },
    assignedExpert: { select: { userId: true } },
  } satisfies Prisma.StudentPortraitInclude;

  async findByUserId(userId: number): Promise<PortraitEntity | null> {
    const portrait = await this.prisma.studentPortrait.findUnique({ where: { userId }, include: this.portraitInclude });

    return portrait ? new PortraitEntity({ ...portrait, expertUserId: portrait.assignedExpert?.userId ?? null }) : null;
  }

  async findRawByUserId(userId: number) {
    return this.prisma.studentPortrait.findUnique({
      where: { userId },
    });
  }

  async updateByUserId(userId: number, data: Prisma.StudentPortraitUpdateInput): Promise<PortraitEntity> {
    const portrait = await this.prisma.studentPortrait.update({
      where: { userId },
      data,
      include: this.portraitInclude,
    });

    return new PortraitEntity({ ...portrait, expertUserId: portrait.assignedExpert?.userId ?? null });
  }

  async addLanguage(studentPortraitId: number, data: AddPortraitLanguageDto) {
    return this.prisma.userLanguages.create({
      data: {
        portraitId: studentPortraitId,
        languageId: data.languageId,
        level: data.level,
      },
    });
  }

  async deleteLanguage(studentPortraitId: number, languageId: number) {
    return this.prisma.userLanguages.delete({
      where: {
        portraitId_languageId: {
          portraitId: studentPortraitId,
          languageId,
        },
      },
    });
  }

  async addTest(studentPortraitId: number, data: CreatePortraitTestDto) {
    return this.prisma.languageTest.create({
      data: {
        studentPortraitId,
        testType: data.testType,
        totalScore: data.totalScore,
        reading: data.reading,
        listening: data.listening,
        writing: data.writing,
        speaking: data.speaking,
        testDate: data.testDate ? new Date(data.testDate) : undefined,
      },
    });
  }

  async findTestById(studentPortraitId: number, testId: number) {
    return this.prisma.languageTest.findFirst({
      where: {
        id: testId,
        studentPortraitId,
      },
    });
  }

  async updateTest(studentPortraitId: number, testId: number, data: UpdatePortraitTestDto) {
    const test = await this.findTestById(studentPortraitId, testId);

    if (!test) {
      throw new NotFoundException(messages.NOT_FOUND_BY_ID("LanguageTest", testId));
    }

    return this.prisma.languageTest.update({
      where: { id: testId },
      data: {
        testType: data.testType,
        totalScore: data.totalScore,
        reading: data.reading,
        listening: data.listening,
        writing: data.writing,
        speaking: data.speaking,
        testDate: data.testDate !== undefined ? new Date(data.testDate) : undefined,
      },
    });
  }

  async deleteTest(studentPortraitId: number, testId: number) {
    const test = await this.findTestById(studentPortraitId, testId);
    if (!test) {
      throw new NotFoundException(messages.NOT_FOUND_BY_ID("LanguageTest", testId));
    }
    return this.prisma.languageTest.delete({
      where: { id: testId },
    });
  }

  async findAssignedByExpertUserId(expertUserId: number) {
    return this.prisma.studentPortrait.findMany({
      where: {
        assignedExpert: { userId: expertUserId },
        sourceEventId: null,
      },
      include: {
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            phoneNumber: true,
            createdAt: true,
            studentContracts: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { status: true },
            },
          },
        },
      },
    });
  }

  async findAllWithLatestContract() {
    return this.prisma.studentPortrait.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            phoneNumber: true,
            createdAt: true,
            studentContracts: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { status: true },
            },
          },
        },
      },
    });
  }

  async updateSubscriptionAndConsultant(studentUserId: number, subscription: SubscriptionTier, consultantProfileId: number | null): Promise<void> {
    const data: Prisma.StudentPortraitUpdateInput = { subscription };
    if (consultantProfileId !== null) {
      data.assignedExpert = { connect: { id: consultantProfileId } };
    }
    await this.prisma.studentPortrait.update({ where: { userId: studentUserId }, data });
  }

  async upsertStudentPackage(studentId: number, expertId: number, totalSlots: number): Promise<void> {
    await this.prisma.studentPackage.upsert({
      where: { studentId_expertId: { studentId, expertId } },
      create: { studentId, expertId, totalSlots },
      update: { totalSlots: { increment: totalSlots } },
    });
  }

  async assignEventSource(userId: number, sourceEventId: number, consultantProfileId: number | null): Promise<void> {
    const data: Prisma.StudentPortraitUpdateInput = {
      sourceEvent: { connect: { id: sourceEventId } },
    };

    if (consultantProfileId) {
      data.assignedExpert = { connect: { id: consultantProfileId } };
    }

    await this.prisma.studentPortrait.update({
      where: { userId },
      data,
    });
  }

  async addTargetCountry(studentPortraitId: number, countryId: number) {
    return this.prisma.studentPortraitTargets.create({
      data: {
        studentPortraitId,
        countryId,
      },
      include: {
        country: true,
      },
    });
  }

  async deleteTargetCountry(studentPortraitId: number, countryId: number) {
    return this.prisma.studentPortraitTargets.delete({
      where: {
        studentPortraitId_countryId: {
          studentPortraitId,
          countryId,
        },
      },
    });
  }
}
