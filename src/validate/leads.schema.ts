import { JSONSchema7 } from 'json-schema';

/**
 * "Leads (triagem)": shape checks of the bodies. The detailed rules (enums, sizes, phone numbers) and their
 * Brazilian Portuguese messages live in src/utils/leads.ts, shared with the MCP tools.
 */
export const leadPatchSchema: JSONSchema7 = {
  type: 'object',
  description: 'Envie um objeto JSON com os campos a alterar.',
};

export const leadSettingsSchema: JSONSchema7 = {
  type: 'object',
  description: 'Envie um objeto JSON com as configurações.',
};

export const leadBackfillSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    days: { type: 'integer', minimum: 1, maximum: 60, description: '"days" deve ser um número inteiro de 1 a 60.' },
    max: { type: 'integer', minimum: 1, maximum: 500, description: '"max" deve ser um número inteiro de 1 a 500.' },
    dryRun: { type: 'boolean', description: '"dryRun" deve ser true ou false.' },
    reanalyze: { type: 'boolean', description: '"reanalyze" deve ser true ou false.' },
  },
  additionalProperties: false,
};

export const leadAnalyzeSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    contact: {
      type: 'string',
      minLength: 3,
      maxLength: 120,
      description: '"contact" é o número com DDI e DDD (ex.: 5521999998888) ou o JID do contato.',
    },
  },
  required: ['contact'],
  additionalProperties: false,
};
