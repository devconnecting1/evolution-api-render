import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

const text = (max: number, label: string): JSONSchema7 => ({
  type: ['string', 'null'],
  maxLength: max,
  description: `"${label}" pode ter até ${max} caracteres.`,
});
const flag = (label: string): JSONSchema7 => ({ type: 'boolean', description: `"${label}" deve ser true ou false.` });

const processFields: Record<string, JSONSchema7> = {
  apelido: text(120, 'apelido'),
  clientName: text(120, 'clientName'),
  remoteJid: text(100, 'remoteJid'),
  tribunalAlias: text(20, 'tribunalAlias'),
  active: flag('active'),
  notifyTeam: flag('notifyTeam'),
  notifyClient: flag('notifyClient'),
  allowAiAnswer: flag('allowAiAnswer'),
  segredoJustica: flag('segredoJustica'),
};

/** POST /processos/:instanceName (CNJ check digit and alias are checked in the service). */
export const processCreateSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    numero: { type: 'string', minLength: 1, maxLength: 40, description: 'Informe o número do processo (CNJ).' },
    ...processFields,
  },
  required: ['numero'],
};

/** PUT /processos/:instanceName/:id */
export const processUpdateSchema: JSONSchema7 = { $id: v4(), type: 'object', properties: processFields };

/** POST /processos/:instanceName/bulk */
export const processBulkSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    lista: { type: 'string', minLength: 1, maxLength: 20000, description: 'Cole a lista de números (até 200).' },
    notifyTeam: flag('notifyTeam'),
  },
  required: ['lista'],
};

/** POST /processos/:instanceName/oab and PUT /processos/:instanceName/oab/:oabId */
export const oabWatchSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    numeroOab: { type: 'string', maxLength: 20, description: 'Número da OAB (ex.: 123456).' },
    ufOab: { type: 'string', maxLength: 2, description: 'UF da OAB (ex.: RJ).' },
    label: text(120, 'label'),
    active: flag('active'),
  },
};

/** POST /processos/:instanceName/publicacoes/seen */
export const publicationsSeenSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    ids: { type: 'array', maxItems: 500, items: { type: 'string', maxLength: 40 }, description: 'Lista de ids.' },
    all: flag('all'),
  },
};

/** POST /processos/:instanceName/settings (ranges and template rules are checked in the service). */
export const processSettingsSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    enabled: flag('enabled'),
    checkEveryHours: { type: 'integer', description: '"checkEveryHours" deve ser um número inteiro de 2 a 48.' },
    djenDays: { type: 'integer', description: '"djenDays" deve ser um número inteiro de 1 a 30.' },
    notifyNumbers: {
      type: 'array',
      maxItems: 10,
      items: { type: 'string', maxLength: 30 },
      description: '"notifyNumbers" é uma lista de até 10 números.',
    },
    quietHours: {
      type: 'object',
      properties: {
        enabled: flag('quietHours.enabled'),
        start: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Início: use HH:MM.' },
        end: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Fim: use HH:MM.' },
        timezone: { type: 'string', maxLength: 64 },
      },
    },
    clientMessageTemplate: text(500, 'clientMessageTemplate'),
  },
};
