import { InstanceDto } from '@api/dto/instance.dto';
import { REVIEW_FORMATS, ReviewExportService, ReviewFormat } from '@api/services/review-export.service';
import { BadRequestException, NotFoundException } from '@exceptions';
import { parseReviewPeriod, ReviewPeriod, ReviewPeriodError } from '@utils/conversation-review';

/**
 * GET /export/review/:instanceName?from=AAAA-MM-DD&to=AAAA-MM-DD&format=md|jsonl. Validates, reads the period
 * (a database error still becomes a normal JSON error) and returns the ZIP as a stream for the router to write.
 */
export class ReviewExportController {
  constructor(
    private readonly service: ReviewExportService,
    private readonly prisma: any,
  ) {}

  public async exportReview(instance: InstanceDto, query: Record<string, any>) {
    let period: ReviewPeriod;
    try {
      period = parseReviewPeriod(query?.from, query?.to);
    } catch (error) {
      if (error instanceof ReviewPeriodError) throw new BadRequestException(error.message);
      throw error;
    }
    const format = String(query?.format ?? 'md') as ReviewFormat;
    if (!REVIEW_FORMATS.includes(format)) throw new BadRequestException('format: use md ou jsonl.');

    const row = await this.prisma.instance.findUnique({
      where: { name: instance.instanceName },
      select: { id: true, name: true },
    });
    if (!row) throw new NotFoundException(`A instância "${instance.instanceName}" não existe.`);

    const collection = await this.service.collect(row.id, period);
    return {
      filename: this.service.fileName(row.name, period),
      conversations: collection.conversations.length,
      messages: collection.messages,
      partial: collection.partial,
      stream: this.service.streamZip(row.name, period, format, collection),
    };
  }
}
