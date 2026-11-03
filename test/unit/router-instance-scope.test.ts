import '../helpers/setup';
// Loads the routers graph before abstract.router (as the app does): importing abstract.router first hits a
// circular import (abstract.router -> @exceptions -> routes/index.router -> channel routers -> abstract.router)
import '@exceptions';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';

/**
 * #2435 (CWE-639): the auth guard checks an instance token against the instance of the path only. The query
 * must not be able to swap that instance (`/chat/findMessages/A?instanceName=B` with the token of A).
 */
class Router extends RouterBroker {}

const request = (params: Record<string, any>, query: Record<string, any> = {}, extra: Record<string, any> = {}) =>
  ({ params: { ...params }, query, body: {}, originalUrl: '/chat/findMessages/A', ...extra }) as any;

const run = async (req: any) => {
  let received: any;
  await new Router().dataValidate<any>({
    request: req,
    schema: null,
    ClassRef: InstanceDto,
    execute: async (instance) => {
      received = instance;
    },
  });
  return received;
};

describe('RouterBroker: the instance comes from the path, never from the query (#2435)', () => {
  test('instanceName and instanceId in the query are ignored when the path names the instance', async () => {
    const instance = await run(request({ instanceName: 'A' }, { instanceName: 'B', instanceId: 'id-of-b', page: '2' }));

    assert.equal(instance.instanceName, 'A');
    assert.equal(instance.instanceId, undefined);
    assert.equal(instance.page, '2', 'other query parameters still pass');
  });

  test('without a path instance the query keeps filtering (fetchInstances?instanceName=, used by the Manager)', async () => {
    const instance = await run(
      request({}, { instanceName: 'escritorio', instanceId: 'abc' }, { originalUrl: '/instance/fetchInstances' }),
    );

    assert.equal(instance.instanceName, 'escritorio');
    assert.equal(instance.instanceId, 'abc');
  });

  test('instance creation still takes instanceName from the body', async () => {
    const instance = await run(
      request(
        {},
        {},
        { originalUrl: '/instance/create', body: { instanceName: 'novo', integration: 'WHATSAPP-BAILEYS' } },
      ),
    );

    assert.equal(instance.instanceName, 'novo');
  });

  test('queryWithoutInstance does not touch the request query', () => {
    const req = request({ instanceName: 'A' }, { instanceName: 'B', remoteJid: 'x' });
    assert.deepEqual(RouterBroker.queryWithoutInstance(req), { remoteJid: 'x' });
    assert.deepEqual(req.query, { instanceName: 'B', remoteJid: 'x' });
  });
});
