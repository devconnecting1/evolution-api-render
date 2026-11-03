import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

const TIME = '^(([01]\\d|2[0-3]):[0-5]\\d|24:00)$';

const cap = (label: string): JSONSchema7 => ({
  type: ['integer', 'null'],
  minimum: 1,
  maximum: 10_000_000,
  description: `"${label}" deve ser um número inteiro de 1 a 10.000.000, ou null para sem limite.`,
});

const dayRanges: JSONSchema7 = {
  type: 'array',
  maxItems: 4,
  description: 'Cada dia aceita até 4 faixas no formato ["HH:MM", "HH:MM"] (00:00 a 23:59; 24:00 só como fim).',
  items: {
    type: 'array',
    minItems: 2,
    maxItems: 2,
    description: 'Cada faixa é ["início", "fim"], por exemplo ["09:00", "18:00"].',
    items: {
      type: 'string',
      pattern: TIME,
      description: 'Horário inválido: use HH:MM, de 00:00 a 23:59 (24:00 só como fim da faixa).',
    },
  },
};

/**
 * POST /usage/limits/:instanceName. Every field is optional (absent = unchanged, null = cleared); the
 * semantic checks (time zone, empty ranges, message required by the action) are in src/utils/usageLimits.ts.
 */
export const usageLimitsSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    planName: {
      type: ['string', 'null'],
      enum: ['Essencial', 'Profissional', 'Premium', 'Personalizado', null],
      description: '"planName" deve ser Essencial, Profissional, Premium, Personalizado ou null.',
    },
    monthlyResponses: cap('monthlyResponses'),
    dailyResponses: cap('dailyResponses'),
    perContactDailyResponses: cap('perContactDailyResponses'),
    overLimitAction: {
      type: 'string',
      enum: ['continue', 'pause', 'message'],
      description: '"overLimitAction" deve ser continue, pause ou message.',
    },
    overLimitMessage: {
      type: ['string', 'null'],
      maxLength: 1000,
      description: '"overLimitMessage" deve ser um texto de até 1.000 caracteres ou null.',
    },
    alertPercent: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description: '"alertPercent" deve ser um número inteiro de 1 a 100.',
    },
    businessHours: {
      type: ['object', 'null'],
      properties: {
        enabled: { type: 'boolean', description: '"businessHours.enabled" deve ser true ou false.' },
        mode: {
          type: 'string',
          enum: ['always', 'inside', 'outside'],
          description: '"businessHours.mode" deve ser always, inside ou outside.',
        },
        timezone: {
          type: 'string',
          minLength: 1,
          maxLength: 64,
          description: '"businessHours.timezone" deve ser um fuso IANA, por exemplo America/Sao_Paulo.',
        },
        week: {
          type: 'object',
          properties: {
            sun: dayRanges,
            mon: dayRanges,
            tue: dayRanges,
            wed: dayRanges,
            thu: dayRanges,
            fri: dayRanges,
            sat: dayRanges,
          },
          additionalProperties: false,
          description: '"businessHours.week" usa as chaves sun, mon, tue, wed, thu, fri e sat.',
        },
      },
      additionalProperties: false,
    },
    outsideHoursMessage: {
      type: ['string', 'null'],
      maxLength: 1000,
      description: '"outsideHoursMessage" deve ser um texto de até 1.000 caracteres ou null.',
    },
  },
};
