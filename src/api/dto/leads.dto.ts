import { LeadPriority, LeadStatus, NotifyOn } from '@utils/leads';

/** Body of PATCH /leads/:instanceName/:id: every field optional; each edited field is locked against the AI. */
export class LeadPatchDto {
  status?: LeadStatus;
  priority?: LeadPriority;
  priorityReason?: string | null;
  name?: string | null;
  area?: string | null;
  city?: string | null;
  nextStep?: string | null;
  summary?: string | null;
  opposingParty?: string | null;
  hasLawyer?: boolean | null;
  missingInfo?: string[];
}

/** Body of POST /leads/settings/:instanceName (absent = unchanged). */
export class LeadSettingsDto {
  enabled?: boolean;
  areas?: string[];
  extractionModel?: string | null;
  notify?: { enabled?: boolean; numbers?: string[]; on?: NotifyOn };
}

/** Body of POST /leads/backfill/:instanceName. */
export class LeadBackfillDto {
  days?: number;
  max?: number;
  dryRun?: boolean;
}
