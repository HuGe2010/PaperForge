import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

/**
 * 全局异常过滤器：
 * - HttpException → 原样状态码 + 规整 message
 * - Prisma 已知错误 → 映射为友好中文提示
 * - 其他 → 500
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = this.normalizeMessage(res);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = '数据已存在（唯一约束冲突）';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = '记录不存在或已被删除';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.BAD_REQUEST;
        message = '存在关联数据，无法执行该操作';
      } else {
        status = HttpStatus.BAD_REQUEST;
        message = '数据库请求错误';
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = '数据库参数校验失败';
    }

    if (status >= 500) {
      this.logger.error(`[${request.method}] ${request.url}`, (exception as Error)?.stack);
    }

    response.status(status).json({
      code: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private normalizeMessage(res: string | object): string {
    if (typeof res === 'string') return res;
    const body = res as { message?: string | string[]; error?: string };
    if (Array.isArray(body.message)) return body.message.join('，');
    if (body.message) return body.message;
    return body.error ?? '请求失败';
  }
}
