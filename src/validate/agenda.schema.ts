import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

const TIME = '^(([01]\\d|2[0-3]):[0-5]\\d|24:00)$';
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const START = '^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}';

const text = (label: string, max: number): JSONSchema7 => ({
  type: ['string', 'null'],
  maxLength: max,
  description: `"${label}" deve ser um texto de até ${max} caracteres.`,
});
const int = (label: string, min: number, max: number): JSONSchema7 => ({
  type: 'integer',
  minimum: min,
  maximum: max,
  description: `"${label}" deve ser um número inteiro de ${min} a ${max}.`,
});
const bool = (label: string): JSONSchema7 => ({ type: 'boolean', description: `"${label}" deve ser true ou false.` });
const status: JSONSchema7 = {
  type: 'string',
  enum: ['agendado', 'confirmado', 'cancelado', 'realizado', 'faltou'],
  description: '"status" deve ser agendado, confirmado, cancelado, realizado ou faltou.',
};
const startsAt: JSONSchema7 = {
  type: 'string',
  pattern: START,
  description:
    '"startsAt" deve ser data e hora ISO, por exemplo 2026-11-12T14:00 (fuso da agenda) ou 2026-11-12T17:00:00Z.',
};

export const appointmentCreateSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    remoteJid: text('remoteJid', 100),
    number: text('number', 30),
    contactName: text('contactName', 120),
    typeName: text('typeName', 80),
    startsAt,
    notes: text('notes', 2000),
    notifyClient: bool('notifyClient'),
  },
  required: ['startsAt'],
};

export const appointmentUpdateSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    status,
    startsAt,
    typeName: { type: 'string', maxLength: 80, description: '"typeName" deve ser o nome de um tipo de atendimento.' },
    notes: text('notes', 2000),
    contactName: text('contactName', 120),
    notifyClient: bool('notifyClient'),
  },
};

const ranges: JSONSchema7 = {
  type: 'array',
  maxItems: 6,
  description: 'Cada dia aceita até 6 faixas ["HH:MM", "HH:MM"] (24:00 só como fim).',
  items: {
    type: 'array',
    minItems: 2,
    maxItems: 2,
    items: { type: 'string', pattern: TIME, description: 'Horário inválido: use HH:MM.' },
  },
};

export const agendaSettingsSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    enabled: bool('enabled'),
    timezone: { type: 'string', minLength: 1, maxLength: 64, description: '"timezone" deve ser um fuso IANA.' },
    slotMinutes: int('slotMinutes', 5, 240),
    bufferMinutes: int('bufferMinutes', 0, 240),
    minNoticeHours: int('minNoticeHours', 0, 720),
    maxDaysAhead: int('maxDaysAhead', 1, 365),
    availability: {
      type: 'object',
      properties: { sun: ranges, mon: ranges, tue: ranges, wed: ranges, thu: ranges, fri: ranges, sat: ranges },
      additionalProperties: false,
      description: '"availability" deve ter os dias sun..sat com faixas ["HH:MM", "HH:MM"].',
    },
    blocks: {
      type: 'array',
      maxItems: 60,
      description: '"blocks": até 60 bloqueios {start, end?, from?, to?, reason?}.',
      items: {
        type: 'object',
        properties: {
          start: { type: 'string', pattern: DATE, description: 'Data do bloqueio: AAAA-MM-DD.' },
          end: { type: ['string', 'null'], description: 'Data final do bloqueio: AAAA-MM-DD.' },
          from: { type: ['string', 'null'], description: 'Início do bloqueio no dia: HH:MM.' },
          to: { type: ['string', 'null'], description: 'Fim do bloqueio no dia: HH:MM.' },
          reason: text('reason', 120),
        },
        required: ['start'],
      },
    },
    appointmentTypes: {
      type: 'array',
      maxItems: 10,
      description: '"appointmentTypes": até 10 tipos {name, minutes, mode, location?, instructions?}.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80, description: 'Nome do tipo de atendimento.' },
          minutes: int('minutes', 5, 480),
          mode: {
            type: 'string',
            enum: ['presencial', 'online', 'telefone'],
            description: 'Modo: presencial, online ou telefone.',
          },
          location: text('location', 300),
          instructions: text('instructions', 500),
        },
        required: ['name', 'minutes'],
      },
    },
    reminders: {
      type: 'object',
      properties: {
        enabled: bool('reminders.enabled'),
        hoursBefore: {
          type: 'array',
          maxItems: 3,
          items: int('hoursBefore', 1, 72),
          description: 'Até 3 lembretes, de 1 a 72 horas antes.',
        },
      },
    },
    confirmation: { type: 'object', properties: { enabled: bool('confirmation.enabled') } },
    aiPermissions: {
      type: 'object',
      properties: { canBook: bool('canBook'), canCancel: bool('canCancel'), canReschedule: bool('canReschedule') },
    },
    notifyNumbers: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string', maxLength: 30, description: 'Número da equipe: DDI + DDD + número.' },
      description: '"notifyNumbers": até 5 números da equipe.',
    },
  },
};
