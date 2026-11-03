import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createJid } from '@utils/createJid';

/**
 * #2687 / upstream PR #2688 (not applied): Brazilian mobile accounts of area codes 31 and above that existed
 * before the ninth digit keep a 12 digit JID on WhatsApp. createJid removes the ninth digit there on purpose;
 * forcing 13 digits would break sends to those contacts. These tests pin the current behavior.
 */
describe('createJid: Brazilian numbers', () => {
  test('area codes 11 to 28 keep the ninth digit', () => {
    assert.equal(createJid('5511987654321'), '5511987654321@s.whatsapp.net');
    assert.equal(createJid('5521987654321'), '5521987654321@s.whatsapp.net');
    assert.equal(createJid('5527987654321'), '5527987654321@s.whatsapp.net');
    assert.equal(createJid('5528999998888'), '5528999998888@s.whatsapp.net');
  });

  test('area codes 31 and above drop the ninth digit of mobiles (subscriber starting with 7, 8 or 9)', () => {
    assert.equal(createJid('5547989211984'), '554789211984@s.whatsapp.net');
    assert.equal(createJid('5531987654321'), '553187654321@s.whatsapp.net');
    assert.equal(createJid('5585977776666'), '558577776666@s.whatsapp.net');
    assert.equal(createJid('5561971234567'), '556171234567@s.whatsapp.net');
  });

  test('area codes 31 and above keep 13 digits when the subscriber starts below 7', () => {
    assert.equal(createJid('5531936541234'), '5531936541234@s.whatsapp.net');
    assert.equal(createJid('5541961234567'), '5541961234567@s.whatsapp.net');
  });

  test('12 digit numbers (already without the ninth digit, or landlines) are kept', () => {
    assert.equal(createJid('554789211984'), '554789211984@s.whatsapp.net');
    assert.equal(createJid('551133334444'), '551133334444@s.whatsapp.net');
  });

  test('formatting characters are removed before the rule is applied', () => {
    assert.equal(createJid('+55 (47) 98921-1984'), '554789211984@s.whatsapp.net');
    assert.equal(createJid('+55 (11) 98765-4321'), '5511987654321@s.whatsapp.net');
  });

  test('JIDs are returned as they are', () => {
    assert.equal(createJid('5547989211984@s.whatsapp.net'), '5547989211984@s.whatsapp.net');
    assert.equal(createJid('123456789012345@lid'), '123456789012345@lid');
    assert.equal(createJid('120363000000000000@g.us'), '120363000000000000@g.us');
  });
});
