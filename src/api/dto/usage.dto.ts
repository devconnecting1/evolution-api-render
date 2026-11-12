import { BusinessHours, OverLimitAction } from '@utils/usageLimits';

/** Body of POST /usage/limits/:instanceName: every field optional (absent = unchanged, null = cleared). */
export class UsageLimitsDto {
  planName?: string | null;
  monthlyResponses?: number | null;
  dailyResponses?: number | null;
  perContactDailyResponses?: number | null;
  overLimitAction?: OverLimitAction;
  overLimitMessage?: string | null;
  alertPercent?: number;
  businessHours?: Partial<BusinessHours> | null;
  outsideHoursMessage?: string | null;
}

/** Body of POST/PATCH /usage/billing/:instanceName: validated in BillingService, every field optional on update. */
export class BillingEntryDto {
  period?: string;
  amountCents?: number;
  status?: string;
  method?: string | null;
  paidAt?: string | null;
  note?: string | null;
}
