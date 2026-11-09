/**
 * Every test in one process, for `npm test` (watch mode). `npm run test:run` runs each file in its own process.
 * Integration tests are skipped unless TEST_DATABASE_URL points to a disposable PostgreSQL
 * (see test/scripts/local-postgres.sh).
 */
import './unit/humanPause.test';
import './unit/botMessageRegistry.test';
import './unit/openai.service.test';
import './unit/cloudapi-webhook.test';
import './unit/observability.test';
import './unit/lidMerge.test';
import './unit/mcp.test';
import './unit/authStatePrisma.test';
import './unit/usage.test';
import './unit/agenda.test';
import './unit/agenda-openai.test';
import './unit/agenda-router.test';
import './integration/openai-human-pause.test';
import './integration/openai-status.test';
import './integration/cloudapi-human-pause.test';
import './integration/observability-system.test';
import './integration/chat-lid-merge.test';
import './integration/auth-state-keys.test';
import './integration/usage-counter.test';
import './integration/agenda.test';
