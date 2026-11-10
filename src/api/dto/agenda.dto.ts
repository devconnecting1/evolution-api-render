/** POST /agenda/:instanceName (manual booking by the team). */
export class AppointmentCreateDto {
  remoteJid?: string;
  number?: string;
  contactName?: string | null;
  typeName?: string | null;
  startsAt: string;
  notes?: string | null;
  notifyClient?: boolean;
}

/** PATCH /agenda/:instanceName/:id. */
export class AppointmentUpdateDto {
  status?: 'agendado' | 'confirmado' | 'cancelado' | 'realizado' | 'faltou';
  startsAt?: string;
  typeName?: string;
  notes?: string | null;
  contactName?: string | null;
  notifyClient?: boolean;
}

/** POST /agenda/settings/:instanceName: every field optional (absent = unchanged). */
export class AgendaSettingsDto {
  [key: string]: any;
}
