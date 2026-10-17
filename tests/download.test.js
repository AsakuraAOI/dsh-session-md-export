import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { sessionMarkdownResponse } from '../index.js';

async function download(titles, headerTitle) {
  const state = { flushed: false, closed: false };
  const ctx = { get(name) {
    if (name === 'sessions') return { get: () => ({}), flush: async () => { state.flushed = true; } };
    if (name === 'sessionPersistence') return { open: async () => {
      assert.equal(state.flushed, true);
      return { header: { id: 'session-test', title: headerTitle }, read: async () => ({ events: titles.map(title => ({ type: 'session/title', data: { title } })) }), close: async () => { state.closed = true; } };
    } };
  } };
  const response = await sessionMarkdownResponse(ctx, new Request('http://localhost/export?sessionId=session-test'));
  assert.equal(response.status, 200);
  assert.equal(state.closed, true);
  const disposition = response.headers.get('content-disposition');
  assert.match(disposition, /^[\x20-\x7e]+$/);
  return { response, filename: decodeURIComponent(disposition.split("filename*=UTF-8''")[1]) };
}

test('UTF-8 attachment name preserves the latest Chinese title, spaces and emoji', async () => {
  const { response, filename } = await download(['旧名称', 'DSH插件版本适配更新 🧪']);
  assert.equal(filename, 'dsh-session-DSH插件版本适配更新 🧪.md');
  assert.match(await response.text(), /# DSH插件版本适配更新 🧪/);
});

test('download filenames sanitize path/header characters and truncate without splitting emoji', async () => {
  const { filename } = await download(['中文/标题\\:*?"<>|\r\n. ']);
  assert.equal(filename, 'dsh-session-中文_标题__________.md');
  const long = await download(['🧪'.repeat(81)]);
  assert.equal(long.filename, `dsh-session-${'🧪'.repeat(80)}.md`);
});

test('missing or empty titles fall back to the header title or Session id', async () => {
  assert.equal((await download([], '中文备用标题')).filename, 'dsh-session-中文备用标题.md');
  assert.equal((await download(['   '])).filename, 'dsh-session-session-test.md');
  assert.equal((await download(['...'])).filename, 'dsh-session-session-test.md');
});

test('browser download defers filename selection to Content-Disposition after HEAD succeeds', async () => {
  let component, anchor, request;
  const React = { useState: initial => [initial, () => {}], createElement: (type, props, ...children) => ({ type, props, children }) };
  const context = { URLSearchParams, window: { __ModuleLoader__: { load({ factory }) {
    const plugin = factory(name => name === 'react' ? React : {});
    plugin.apply({ slots: { inject: (_, callback) => callback(), register: (_, value) => { component = value; } } });
  } } }, document: { createElement: () => (anchor = { click() { this.clicked = true; }, remove() {} }), body: { append() {} } }, fetch: async (url, init) => { request = { url, init }; return { ok: true }; } };
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), context);
  component({ sessionId: 'session-test' }).children[0].props.onSelect('plain');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(request.init.method, 'HEAD');
  assert.equal(anchor.href, request.url);
  assert.equal(anchor.download, '');
  assert.equal(anchor.clicked, true);
});
