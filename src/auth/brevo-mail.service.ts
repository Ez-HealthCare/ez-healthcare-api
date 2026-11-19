import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ApiConfigService } from '../config/api-config.service';

export interface SendBrevoMailOptions {
  to: string;
  subject: string;
  htmlContent: string;
}

/**
 * Service gửi email giao dịch (Transactional Email) thông qua Brevo REST API (HTTPS cổng 443).
 * Không sử dụng SMTP để tránh bị chặn outbound port trên các môi trường cloud như Render Free Tier.
 */
@Injectable()
export class BrevoMailService {
  private readonly logger = new Logger(BrevoMailService.name);
  private static readonly BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
  private static readonly TIMEOUT_MS = 10_000; // Timeout 10 giây chống treo kết nối

  constructor(private readonly config: ApiConfigService) {}

  /**
   * Gửi email OTP / thông báo qua Brevo REST API
   * @param options Thông tin người nhận, tiêu đề và nội dung HTML
   */
  async sendMail(options: SendBrevoMailOptions): Promise<{ success: boolean; messageId?: string }> {
    const brevoConfig = this.config.brevo;

    // 1. Kiểm tra cấu hình biến môi trường bắt buộc
    if (!brevoConfig.apiKey) {
      this.logger.error('Thiếu cấu hình BREVO_API_KEY. Vui lòng thiết lập biến môi trường này.');
      throw new ServiceUnavailableException('Chưa cấu hình BREVO_API_KEY cho hệ thống gửi email.');
    }

    if (!brevoConfig.senderEmail) {
      this.logger.error(
        'Thiếu cấu hình MAIL_SENDER_EMAIL. Vui lòng thiết lập biến môi trường này.',
      );
      throw new ServiceUnavailableException(
        'Chưa cấu hình MAIL_SENDER_EMAIL cho hệ thống gửi email.',
      );
    }

    // 2. Chuẩn bị payload theo đúng chuẩn API của Brevo
    const payload = {
      sender: {
        name: brevoConfig.senderName || 'Ez-HealthCare',
        email: brevoConfig.senderEmail,
      },
      to: [{ email: options.to }],
      subject: options.subject,
      htmlContent: options.htmlContent,
    };

    let response: Response;
    try {
      // 3. Gọi REST API qua HTTPS (cổng 443) kèm timeout 10s
      response = await fetch(BrevoMailService.BREVO_API_URL, {
        method: 'POST',
        headers: {
          'api-key': brevoConfig.apiKey,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(BrevoMailService.TIMEOUT_MS),
      });
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      this.logger.error(
        `Lỗi kết nối tới Brevo API: ${isTimeout ? 'Request bị timeout sau 10 giây' : (err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        isTimeout
          ? 'Kết nối gửi email tới Brevo bị quá thời gian (10s).'
          : 'Không thể kết nối đến dịch vụ gửi email Brevo.',
      );
    }

    // 4. Bắt lỗi HTTP từ Brevo và phân loại chi tiết (không log API key)
    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        errorBody = 'Không thể đọc phản hồi lỗi từ server';
      }

      const status = response.status;
      let detailedMessage = '';

      switch (status) {
        case 400:
          detailedMessage =
            'Brevo 400: Sender email chưa được xác minh (verify) trong Brevo hoặc định dạng dữ liệu không hợp lệ.';
          break;
        case 401:
          detailedMessage =
            'Brevo 401: API key không chính xác hoặc IP chưa được cấp quyền trong tài khoản Brevo.';
          break;
        case 429:
          detailedMessage =
            'Brevo 429: Đã vượt quá giới hạn gửi email (hạn mức 300 email/ngày của gói Free).';
          break;
        default:
          detailedMessage = `Brevo ${status}: Lỗi phản hồi từ Brevo API.`;
      }

      // Log chi tiết mã lỗi và thông báo (bảo mật tuyệt đối, không log API key)
      this.logger.error(
        `[Brevo Error] HTTP ${status}: ${detailedMessage} | Chi tiết: ${errorBody}`,
      );

      throw new ServiceUnavailableException(`Dịch vụ gửi email thất bại (${detailedMessage})`);
    }

    let responseData: any = {};
    try {
      responseData = await response.json();
    } catch {
      // Body có thể rỗng hoặc plain text
    }

    this.logger.log(
      `Gửi email Brevo thành công tới ${options.to} (MessageId: ${responseData.messageId || 'N/A'})`,
    );
    return { success: true, messageId: responseData.messageId };
  }
}
