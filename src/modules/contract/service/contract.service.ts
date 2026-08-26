import { BadRequestException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { ContractRepository } from "../repository/contract.repository";
import { OtpService } from "./otp.service";
import { PdfService } from "./pdf.service";
import { StudentPortraitService } from "src/modules/studentportrait/service/studentportrait.service";
import { CreateContractForStudentDto } from "../api/dto/create-contract-for-student.dto";
import { SignStudentContractDto } from "../api/dto/sign-student-contract.dto";
import { UpdateContractMetaDto } from "../api/dto/update-contract-meta.dto";
import { ContractStatus } from "generated/prisma/enums";
import { MailService } from "src/modules/mail/mail.service";
import messages from "src/configs/messages";

import { UserJourneyLogService } from "src/modules/user-journey/user-journey-log.service";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";

@Injectable()
export class ContractService {
  private readonly entity = "Contract";
  private readonly logger = new Logger(ContractService.name);

  constructor(
    private readonly repo: ContractRepository,
    private readonly otpService: OtpService,
    private readonly pdfService: PdfService,
    private readonly mailService: MailService,
    private readonly portraitService: StudentPortraitService,
    private readonly userJourneyLog: UserJourneyLogService,
  ) {}

  // ─── Student ──────────────────────────────────────────────────────────────

  async getMyContract(userId: number) {
    try {
      return await this.repo.findByStudentId(userId);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async sendStudentOtp(contractId: string, userId: number, clientPhone: string) {
    try {
      const contract = await this.repo.findById(contractId);
      if (!contract) throw new NotFoundException(messages.NOT_FOUND(this.entity));
      if (contract.studentId !== userId) throw new ForbiddenException("Access denied");
      if (contract.status !== ContractStatus.PENDING_STUDENT) {
        throw new BadRequestException("Contract is not ready for student signature yet");
      }

      const student = (contract as any).student;
      const otp = this.otpService.generate();
      const hash = await this.otpService.hash(otp);

      await this.repo.saveStudentOtp(contractId, hash, this.otpService.expiry(5));
      // Send OTP to the contract phone (may be parent/guardian), not the student's registered number
      await this.otpService.send({ email: student.email, phone: clientPhone, name: student.firstname }, otp);

      return { message: "OTP sent" };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error("Error sending student OTP", err, err?.stack);
      throw new InternalServerErrorException(messages.INTERNAL_ERROR(this.entity));
    }
  }

  async signByStudent(contractId: string, userId: number, dto: SignStudentContractDto) {
    try {
      const contract = await this.repo.findById(contractId);
      if (!contract) throw new NotFoundException(messages.NOT_FOUND(this.entity));
      if (contract.studentId !== userId) throw new ForbiddenException("Access denied");
      if (contract.status !== ContractStatus.PENDING_STUDENT) {
        throw new BadRequestException("Contract is not ready for student signature");
      }
      if (!contract.studentOtpHash || !contract.studentOtpExpiry) {
        throw new BadRequestException("OTP not requested. Please request a code first.");
      }
      if (new Date() > new Date(contract.studentOtpExpiry)) {
        throw new BadRequestException("OTP has expired. Please request a new code.");
      }
      const valid = await this.otpService.verify(dto.otp, contract.studentOtpHash);
      if (!valid) throw new BadRequestException("Invalid OTP");

      const signed = await this.repo.studentSign(contractId, {
        clientFullName: dto.clientFullName,
        studentName: dto.studentName,
        clientIin: dto.clientIin,
        clientAddress: dto.clientAddress,
        clientPhone: dto.clientPhone,
      });

      // Resolve the expert's consultant profile (may not exist for admin signers)
      const consultantProfile = signed.signedByUserId
        ? await (this.repo as any).prisma.consultantProfile.findUnique({
            where: { userId: signed.signedByUserId },
            select: { id: true },
          })
        : null;

      await this.portraitService.activateContractBenefits(signed.studentId, signed.subscriptionTier, consultantProfile?.id ?? null);

      // Generate PDF and send to both parties
      this.sendSignedContractEmails(signed).catch(e => this.logger.error("Failed to send signed contract emails", e));

      void this.userJourneyLog.logEvent(userId, USER_JOURNEY_EVENT.CONTRACT_SIGNED, {
        contractId,
        contractNumber: signed.contractNumber,
      });

      return { message: "Contract signed", status: ContractStatus.SIGNED };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error("Error signing contract (student)", err, err?.stack);
      throw new InternalServerErrorException(messages.INTERNAL_ERROR(this.entity));
    }
  }

  // ─── Expert / Admin ───────────────────────────────────────────────────────

  async createContractForStudent(dto: CreateContractForStudentDto) {
    try {
      const existing = await this.repo.findByStudentId(dto.studentId);
      if (existing) throw new BadRequestException("Student already has a contract");

      return await this.repo.create(dto);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async getContractByStudentId(studentId: number) {
    try {
      const contract = await this.repo.findByStudentId(studentId);
      if (!contract) throw new NotFoundException(messages.NOT_FOUND(this.entity));
      return contract;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async getAllContracts(status?: ContractStatus) {
    try {
      return await this.repo.findAllByStatus(status);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async sendExpertOtp(contractId: string, userId: number) {
    try {
      const contract = await this.repo.findById(contractId);
      if (!contract) throw new NotFoundException(messages.NOT_FOUND(this.entity));
      if (contract.status !== ContractStatus.PENDING_EXPERT) {
        throw new BadRequestException("Contract is not pending expert signature");
      }

      const expertUser = await (this.repo as any).prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, phoneNumber: true, firstname: true },
      });
      if (!expertUser) throw new NotFoundException(messages.NOT_FOUND("User"));

      const otp = this.otpService.generate();
      const hash = await this.otpService.hash(otp);

      await this.repo.saveExpertOtp(contractId, hash, this.otpService.expiry(5));
      await this.otpService.send({ email: expertUser.email, phone: expertUser.phoneNumber, name: expertUser.firstname }, otp);

      return { message: "OTP sent" };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error("Error sending expert OTP", err, err?.stack);
      throw new InternalServerErrorException(messages.INTERNAL_ERROR(this.entity));
    }
  }

  async signByExpert(contractId: string, userId: number) {
    try {
      const contract = await this.repo.findById(contractId);
      if (!contract) throw new NotFoundException(messages.NOT_FOUND(this.entity));
      if (contract.status !== ContractStatus.PENDING_EXPERT) {
        throw new BadRequestException("Contract is not pending expert signature");
      }

      const signed = await this.repo.expertSign(contractId, userId);

      // Notify student that contract is ready to sign
      const student = (signed as any).student;
      this.notifyStudentContractReady(student).catch(e => this.logger.error("Failed to notify student", e));

      return { message: "Contract signed by expert, student notified", status: ContractStatus.PENDING_STUDENT };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error("Error signing contract (expert)", err, err?.stack);
      throw new InternalServerErrorException(messages.INTERNAL_ERROR(this.entity));
    }
  }

  async updateMeta(contractId: string, dto: UpdateContractMetaDto) {
    try {
      const contract = await this.repo.findById(contractId);
      if (!contract) throw new NotFoundException(messages.NOT_FOUND(this.entity));
      if (contract.status === ContractStatus.SIGNED || contract.status === ContractStatus.PAID) {
        throw new BadRequestException("Cannot update a fully signed contract");
      }
      return await this.repo.updateMeta(contractId, {
        contractNumber: dto.contractNumber,
        price: dto.price,
        currency: dto.currency,
        serviceStartDate: dto.serviceStartDate ? new Date(dto.serviceStartDate) : undefined,
        serviceEndDate: dto.serviceEndDate ? new Date(dto.serviceEndDate) : undefined,
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entity), err, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entity));
    }
  }

  async markStudentContractPaid(studentId: number): Promise<void> {
    try {
      await this.repo.markPaidForStudent(studentId);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error("markStudentContractPaid", err, err?.stack);
      throw new InternalServerErrorException(messages.INTERNAL_ERROR(this.entity));
    }
  }

  // ─── Payment gate ─────────────────────────────────────────────────────────

  async isFullySigned(studentId: number): Promise<boolean> {
    return this.repo.isFullySigned(studentId);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async notifyStudentContractReady(student: { email: string; firstname: string }) {
    await this.mailService.sendMail(
      student.email,
      "Ваш договор готов к подписанию — AcademicApply",
      `Договор готов. Войдите в личный кабинет и подпишите его в разделе «Профиль».`,
      `<p>Здравствуйте, <strong>${student.firstname}</strong>!</p>
       <p>Ваш договор об оказании консалтинговых услуг с ТОО «OXUS GLOBAL STUDENT MOBILITY» готов к подписанию.</p>
       <p>Пожалуйста, войдите в <a href="${process.env.FRONTEND_URL ?? "https://oxusedu.com"}/profile">личный кабинет</a> и ознакомьтесь с договором в разделе «Профиль».</p>`,
    );
  }

  private async sendSignedContractEmails(contract: any) {
    const pdfBuffer = await this.pdfService.generatePdf(contract);
    const attachments = [{ filename: `Договор_${contract.contractNumber}.pdf`, content: pdfBuffer, contentType: "application/pdf" }];

    const student = contract.student;
    const expert = contract.signedByUser;

    await Promise.all([
      this.mailService.sendMail(
        student.email,
        `Договор №${contract.contractNumber} подписан — Oxusedu`,
        `Договор подписан обеими сторонами. Копия во вложении.`,
        `<p>Здравствуйте, <strong>${student.firstname}</strong>!</p>
         <p>Договор №<strong>${contract.contractNumber}</strong> успешно подписан обеими сторонами. Копия прилагается.</p>`,
        attachments,
      ),
      expert
        ? this.mailService.sendMail(
            expert.email,
            `Договор №${contract.contractNumber} подписан студентом — Oxusedu`,
            `Студент подписал договор. Копия во вложении.`,
            `<p>Здравствуйте, <strong>${expert.firstname}</strong>!</p>
             <p>Студент <strong>${student.firstname} ${student.lastname}</strong> подписал договор №<strong>${contract.contractNumber}</strong>. Копия прилагается.</p>`,
            attachments,
          )
        : Promise.resolve(),
    ]);
  }
}
