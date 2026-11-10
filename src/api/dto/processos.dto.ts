/** Bodies of the /processos routes (validated by src/validate/processos.schema.ts and the service). */
export class ProcessBodyDto {
  numero?: string;
  apelido?: string | null;
  clientName?: string | null;
  remoteJid?: string | null;
  tribunalAlias?: string | null;
  active?: boolean;
  notifyTeam?: boolean;
  notifyClient?: boolean;
  allowAiAnswer?: boolean;
  segredoJustica?: boolean;
  lista?: string;
}

export class OabWatchDto {
  numeroOab?: string;
  ufOab?: string;
  label?: string | null;
  active?: boolean;
}

export class PublicationsSeenDto {
  ids?: string[];
  all?: boolean;
}

export class ProcessSettingsDto {
  enabled?: boolean;
  checkEveryHours?: number;
  djenDays?: number;
  notifyNumbers?: string[];
  quietHours?: { enabled?: boolean; start?: string; end?: string; timezone?: string };
  clientMessageTemplate?: string | null;
}
