import {
  conversationIssues,
  IssueConfig,
  IssueFlag,
  IssueType,
  SEVERITIES,
  Severity,
  severityRank,
} from '@utils/ai-issues';
import { JSONL_SENDER, ReviewPeriod, senderCounts } from '@utils/conversation-review';
import { resolveHumanResumeMinutes } from '@utils/humanPause';
import { normalizeBusinessHours } from '@utils/usageLimits';

import { ReviewExportService } from './review-export.service';

export type AiIssuesOptions = {
  unansweredMinutes?: number;
  minSeverity?: Severity;
  /** Conversation offset in the ordered list (cursor of the MCP). */
  offset?: number;
  pageSize?: number;
  /** Unix seconds, for tests. Default: now. */
  now?: number;
};

export type AiIssuesConversation = {
  ref: string;
  firstAt: string;
  lastAt: string;
  counts: Record<string, number>;
  flags: (Omit<IssueFlag, 'at'> & { at: string })[];
};

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/**
 * "find_ai_issues": the conversations of a period with signs of problems of the AI (rules in src/utils/ai-issues.ts).
 * Reads the period once (review-export.service.ts: one keyset range query on the (instanceId, messageTimestamp)
 * index, grouped in memory) plus the bot settings and business hours of the instance. Read-only.
 */
export class AiReviewService {
  constructor(
    private readonly prisma: any,
    private readonly reader = new ReviewExportService(prisma),
  ) {}

  public async config(instanceId: string, period: ReviewPeriod, unansweredMinutes: number, now: number) {
    const [bots, settings, limits] = await Promise.all([
      this.prisma.openaiBot.findMany({
        where: { instanceId, enabled: true },
        orderBy: { createdAt: 'asc' },
        select: { unknownMessage: true, splitMessages: true, stopBotFromMe: true, humanResumeMinutes: true },
      }),
      this.prisma.openaiSetting.findFirst({
        where: { instanceId },
        select: {
          unknownMessage: true,
          splitMessages: true,
          stopBotFromMe: true,
          humanResumeMinutes: true,
          ethicsProfile: true,
        },
      }),
      this.prisma.instanceLimits.findUnique({
        where: { instanceId },
        select: { businessHours: true, outsideHoursMessage: true },
      }),
    ]);
    const all = [...(bots ?? []), ...(settings ? [settings] : [])];
    const config: IssueConfig = {
      unansweredMinutes,
      hours: limits?.businessHours ? normalizeBusinessHours(limits.businessHours) : null,
      fallbackTexts: all.map((row) => row?.unknownMessage).filter((text): text is string => !!text),
      outsideHoursTexts: limits?.outsideHoursMessage ? [limits.outsideHoursMessage] : [],
      pausesForTeam: all.some((row) => row?.stopBotFromMe === true),
      resumeMinutes: resolveHumanResumeMinutes(bots?.[0], settings),
      splitMessages: all.some((row) => row?.splitMessages === true),
      advocacia: settings?.ethicsProfile === 'advocacia',
      until: Math.min(now, period.toSeconds),
    };
    return config;
  }

  public async findIssues(instanceId: string, period: ReviewPeriod, options: AiIssuesOptions = {}) {
    const unansweredMinutes = options.unansweredMinutes ?? 30;
    const minRank = severityRank(options.minSeverity ?? 'baixa');
    const pageSize = Math.max(1, Math.min(options.pageSize ?? 20, 50));
    const offset = Math.max(0, options.offset ?? 0);
    const now = options.now ?? Math.floor(Date.now() / 1000);

    const [collection, config] = await Promise.all([
      this.reader.collect(instanceId, period),
      this.config(instanceId, period, unansweredMinutes, now),
    ]);

    const byFlag: Partial<Record<IssueType, number>> = {};
    const bySender: Record<string, number> = {};
    const flagged = [];
    for (const conversation of collection.conversations) {
      const counts = senderCounts(conversation.entries);
      const labelled = Object.fromEntries(
        Object.entries(counts)
          .filter(([, n]) => n > 0)
          .map(([sender, n]) => [JSONL_SENDER[sender], n]),
      );
      for (const [label, n] of Object.entries(labelled)) bySender[label] = (bySender[label] ?? 0) + (n as number);

      const flags = conversationIssues(conversation, config).filter((f) => severityRank(f.severity) >= minRank);
      if (!flags.length) continue;
      for (const f of flags) byFlag[f.type] = (byFlag[f.type] ?? 0) + 1;
      const top = Math.max(...flags.map((f) => severityRank(f.severity)));
      flagged.push({ conversation, counts: labelled, flags, top });
    }

    flagged.sort(
      (a, b) =>
        b.top - a.top || b.flags.length - a.flags.length || a.conversation.entries[0].at - b.conversation.entries[0].at,
    );

    const page: AiIssuesConversation[] = flagged.slice(offset, offset + pageSize).map((item) => ({
      ref: item.conversation.ref,
      firstAt: iso(item.conversation.entries[0].at),
      lastAt: iso(item.conversation.entries[item.conversation.entries.length - 1].at),
      counts: item.counts,
      flags: item.flags.map((f) => ({ ...f, at: iso(f.at) })),
    }));

    return {
      totals: {
        conversations: collection.conversations.length,
        flaggedConversations: flagged.length,
        messages: collection.messages,
        bySender,
        byFlag,
        partial: collection.partial,
      },
      severities: SEVERITIES.slice(minRank),
      offset,
      pageSize,
      nextCursor: offset + pageSize < flagged.length ? String(offset + pageSize) : null,
      conversations: page,
      config: {
        unansweredMinutes,
        businessHours: !!config.hours?.enabled,
        pausesForTeam: config.pausesForTeam,
        splitMessages: config.splitMessages,
        advocacia: config.advocacia,
      },
    };
  }
}
