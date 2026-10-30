'use strict';
const $ = id => document.getElementById(id);
let tab;
const defaults = { rate: 2, background: true, muted: true, recursive: true, autoNext: true };
async function render() {
  const stored = await chrome.storage.session.get(['xiaoyaRun', 'xiaoyaError', 'xiaoyaPendingScan']);
  const run = stored.xiaoyaRun;
  $('count').textContent = `${run?.completed?.length || 0} 项`;
  $('status').textContent = run ? `${run.tabId !== tab?.id ? '小雅后台运行：' : ''}${run.status || '等待页面响应…'}` : '尚未开始';
  if (stored.xiaoyaPendingScan) $('status').textContent = stored.xiaoyaPendingScan.status;
  if (stored.xiaoyaError?.tabId === tab?.id) $('status').textContent = stored.xiaoyaError.text;
  $('task-count').textContent = `${run?.tasks?.length || 0} 项`;
  $('tasks').replaceChildren(...(run?.tasks || []).map(task => {
    const li = document.createElement('li');
    li.textContent = `${task.course} / ${task.name}`;
    return li;
  }));
  $('logs').replaceChildren(...(run?.logs || []).slice(-6).reverse().map(entry => {
    const li = document.createElement('li');
    li.textContent = `${new Date(entry.time).toLocaleTimeString('zh-CN')} ${entry.text}`;
    return li;
  }));
}
async function initialize() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const options = { ...defaults, ...(await chrome.storage.local.get('options')).options };
  $('rate').value = options.rate;
  for (const key of ['background', 'muted', 'recursive', 'autoNext']) $(key).checked = options[key];
  await render();
}
async function command(type) {
  $('start').disabled = true;
  $('scan').disabled = true;
  try {
    $('status').textContent = type === 'scan' ? '正在连接页面并获取待办…' : '正在启动队列…';
    const options = { rate: Number($('rate').value),
      background: $('background').checked, muted: $('muted').checked, recursive: $('recursive').checked,
      autoNext: $('autoNext').checked };
    await chrome.storage.local.set({ options });
    const result = await chrome.runtime.sendMessage({ type, tabId: tab?.id, options });
    if (result?.error) throw new Error(result.error);
    if (!result?.ok) throw new Error('后台未确认请求，请到浏览器扩展管理页重新加载“小雅刷课助手”后再试。');
    await render();
  } catch (error) { $('status').textContent = error.message; }
  finally { $('start').disabled = false; $('scan').disabled = false; }
}
$('start').addEventListener('click', () => command('start'));
$('scan').addEventListener('click', () => command('scan'));
$('stop').addEventListener('click', async () => {
  const stored = await chrome.storage.session.get(['xiaoyaRun', 'xiaoyaPendingScan']);
  await chrome.runtime.sendMessage({ type: 'stop', tabId: stored.xiaoyaPendingScan?.tabId ?? stored.xiaoyaRun?.tabId ?? tab?.id });
  await render();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && (changes.xiaoyaRun || changes.xiaoyaError || changes.xiaoyaPendingScan)) void render();
});
initialize().catch(error => { $('status').textContent = error.message; });
