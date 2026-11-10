import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLang } from '../public/i18n.js';

test('detectLang follows the browser language', () => {
  assert.equal(detectLang(['zh-CN', 'en']), 'zh');
  assert.equal(detectLang(['en-US', 'zh-Hans-US']), 'en');
  assert.equal(detectLang(['zh-Hant-TW']), 'zh');
  assert.equal(detectLang(['ZH_cn']), 'zh');
});

test('detectLang skips languages without a translation and takes the next preference', () => {
  assert.equal(detectLang(['fr-FR', 'zh-CN', 'en']), 'zh');
  assert.equal(detectLang(['ja', 'en-GB', 'zh']), 'en');
});

test('detectLang falls back to English', () => {
  assert.equal(detectLang(['ja', 'de']), 'en');
  assert.equal(detectLang([]), 'en');
  assert.equal(detectLang([undefined, '']), 'en');
  assert.equal(detectLang(), 'en');
});
