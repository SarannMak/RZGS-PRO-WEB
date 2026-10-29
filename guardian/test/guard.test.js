import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReadOnlySql, redact, timingSafeEqual, isOwner, hostAllowed } from '../src/guard.js';

test('sql gate', () => {
  assert.equal(checkReadOnlySql('select count(*) from public.profiles'), null);
  assert.ok(checkReadOnlySql('delete from profiles'));
  assert.ok(checkReadOnlySql('select 1; drop table x'));
  assert.ok(checkReadOnlySql('select encrypted_password from auth.users'));
  assert.ok(checkReadOnlySql('with x as (select 1) update t set a=1'));
});
test('redact', () => {
  assert.equal(redact('k=ghp_' + 'a'.repeat(30)), 'k=[REDACTED]');
  assert.equal(redact('123456789:' + 'A'.repeat(35)), '[REDACTED]');
});
test('secret compare', () => {
  assert.ok(timingSafeEqual('abc', 'abc'));
  assert.ok(!timingSafeEqual('abc', 'abd'));
  assert.ok(!timingSafeEqual(null, 'abc'));
});
test('owner only, private chats only', () => {
  const env = { OWNER_TELEGRAM_ID: '42' };
  assert.ok(isOwner(env, 42, 'private'));
  assert.ok(!isOwner(env, 42, 'group'));
  assert.ok(!isOwner(env, 7, 'private'));
});
test('ssrf allowlist', () => {
  const env = { SITE_HOSTS: 'rzgspro.com' };
  assert.ok(hostAllowed(env, 'https://rzgspro.com/x'));
  assert.ok(!hostAllowed(env, 'http://rzgspro.com'));
  assert.ok(!hostAllowed(env, 'https://169.254.169.254/'));
  assert.ok(!hostAllowed(env, 'https://rzgspro.com.evil.io/'));
});
