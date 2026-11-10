import { CREDENTIAL_KIND_NAMES } from '@api/services/credentials.service';
import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

/**
 * Every rule has a fixed `description`, so a validation error never echoes the submitted values (the body carries
 * the admin password).
 */
export const credentialRevealSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  description: 'Informe "kind", "id" e "confirmPassword".',
  properties: {
    kind: {
      type: 'string',
      enum: CREDENTIAL_KIND_NAMES,
      description: `"kind" deve ser um de: ${CREDENTIAL_KIND_NAMES.join(', ')}.`,
    },
    id: { type: 'string', minLength: 1, maxLength: 64, description: '"id" deve ter de 1 a 64 caracteres.' },
    confirmPassword: {
      type: 'string',
      minLength: 1,
      maxLength: 512,
      description: '"confirmPassword" é obrigatório (a chave global do administrador).',
    },
  },
  required: ['kind', 'id', 'confirmPassword'],
};
