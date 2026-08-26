import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsNumber, IsOptional, IsEmail, IsIP, IsEnum, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";

export class PaymentIntentDto {
  @IsString()
  pg_status: string;

  @Type(() => Number)
  @IsInt()
  pg_payment_id: number;

  @IsString()
  pg_redirect_url: string;

  @IsString()
  pg_redirect_url_type: string;

  @IsString()
  pg_salt: string;

  @IsString()
  pg_sig: string;
}

export class FreedomPaymentDto {
  @ApiProperty({ example: 1000, description: "Сумма платежа" })
  @IsNumber()
  @Type(() => Number)
  pg_amount: number;

  @ApiProperty({ example: 269499, description: "Код авторизации" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pg_auth_code?: number;

  @ApiProperty({ example: 1, description: "Возможность отмены (0 или 1)" })
  @IsInt()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  pg_can_reject: number;

  @ApiProperty({ example: 1, description: "Признак клиринга (0 или 1)" })
  @IsInt()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  pg_captured: number;

  @ApiProperty({ example: "VI", description: "Бренд карты" })
  @IsOptional()
  @IsString()
  pg_card_brand?: string;

  @ApiProperty({ example: "02/29", description: "Срок действия карты" })
  @IsOptional()
  @IsString()
  pg_card_exp?: string;

  @ApiProperty({ example: "SOME USER", description: "Владелец карты" })
  @IsOptional()
  @IsString()
  pg_card_owner?: string;

  @ApiProperty({ example: "4343-04XX-XXXX-2342", description: "Маскированный PAN" })
  @IsOptional()
  @IsString()
  pg_card_pan?: string;

  @ApiProperty({ example: "KZT", description: "Валюта платежа" })
  @IsString()
  pg_currency: string;

  @ApiProperty({ example: "OxusEdu", description: "Описание платежа" })
  @IsString()
  pg_description: string;

  @ApiProperty({ example: 1, description: "Нужно ли Email уведомление" })
  @IsInt()
  @Type(() => Number)
  pg_need_email_notification: number;

  @ApiProperty({ example: 0, description: "Нужно ли Phone уведомление" })
  @IsInt()
  @Type(() => Number)
  pg_need_phone_notification: number;

  @ApiProperty({ example: 965, description: "Чистая сумма к зачислению" })
  @IsNumber()
  @Type(() => Number)
  pg_net_amount: number;

  @ApiProperty({ example: "127010101213", description: "ID заказа в вашей системе" })
  @IsString()
  pg_order_id: string;

  @ApiProperty({ example: "2026-02-09 14:21:45", description: "Дата платежа" })
  @IsOptional()
  @IsString() // Приходит строкой, можно использовать IsDateString()
  pg_payment_date?: string;

  @ApiProperty({ example: "234234234234", description: "Уникальный ID платежа в Freedom Pay" })
  @IsString() // В HTTP запросах bigint часто передается как строка для точности
  pg_payment_id: string;

  @ApiProperty({ example: "bankcard", description: "Метод оплаты" })
  @IsString()
  pg_payment_method: string;

  @ApiProperty({ example: 1000, description: "Сумма в валюте платежной системы" })
  @IsNumber()
  @Type(() => Number)
  pg_ps_amount: number;

  @ApiProperty({ example: "KZT", description: "Валюта платежной системы" })
  @IsString()
  pg_ps_currency: string;

  @ApiProperty({ example: 1000, description: "Полная сумма транзакции" })
  @IsNumber()
  @Type(() => Number)
  pg_ps_full_amount: number;

  @ApiProperty({ example: "260209092145", description: "RRN / Справочный номер" })
  @IsString()
  pg_reference: string;

  @ApiProperty({ example: 1, description: "Результат (1 - успех, 0 - ошибка)" })
  @IsInt()
  @Type(() => Number)
  pg_result: number;

  @ApiProperty({ example: "POST", description: "Метод вызова Result URL" })
  @IsEnum(["GET", "POST"])
  Pg_result_url_method: string;

  @ApiProperty({ example: "mOoDNNnUw12U100M", description: "Случайная строка" })
  @IsString()
  pg_salt: string;

  @ApiProperty({ example: "d6377e274cf6282a98586ba778ae9afb", description: "Подпись запроса" })
  @IsString()
  pg_sig: string;

  @ApiProperty({ example: 1, description: "Флаг тестового режима" })
  @IsInt()
  @Type(() => Number)
  pg_testing_mode: number;

  @ApiProperty({ example: "someusergmail.com", description: "Email пользователя" })
  @IsEmail()
  @IsOptional()
  pg_user_contact_email: string;

  @ApiProperty({ example: "234.27.17.17", description: "IP адрес пользователя" })
  @IsIP()
  pg_user_ip: string;

  @ApiProperty({ example: "777153242345", description: "Телефон пользователя" })
  @IsString()
  @IsOptional()
  pg_user_phone: string;

  @ApiPropertyOptional({ example: 99999, description: "Код ошибки" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pg_failure_code?: number;

  @ApiPropertyOptional({
    example: "Неизвестная ошибка платежной системы",
    description: "Описание ошибки",
  })
  @IsOptional()
  @IsString()
  pg_failure_description?: string;

  @ApiPropertyOptional({ example: 99999, description: "Show email" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  show_email?: number;
}
