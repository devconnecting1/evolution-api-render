import { CredentialKind } from '@api/services/credentials.service';

/** Body of POST /admin/credentials/reveal. `confirmPassword` is the global key typed again by the admin. */
export class CredentialRevealDto {
  kind: CredentialKind;
  id: string;
  confirmPassword: string;
}
