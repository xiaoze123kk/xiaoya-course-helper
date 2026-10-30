const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function fixture({ done = false, ended = true, file = true, courseware = false, home = false, scanOnly = false, autoNext = true } = {}) {
  let now = 100000;
  let interval;
  let listener;
  let completedClicks = 0;
  let nextClicks = 0;
  let pauses = 0;
  let timingText = null;
  const firstName = courseware ? 'first.pptx' : 'first.mp4';
  const sent = [];
  const events = [];
  const assigned = [];
  let homeOpened = false;
  let homeClicks = 0;
  const allInput = { checked: false };
  const availableInput = { checked: true };
  const homeCard = (name, watch) => ({
    textContent: `${name} 大学生劳动教育`, classList: { contains() { return watch; } },
    querySelector(selector) {
      return selector === 'a.group-resource-link' ? { textContent: name, click() { homeClicks++; } } : { textContent: '大学生劳动教育' };
    }
  });
  const homeCards = [homeCard(firstName, true), homeCard('章节测验', false), homeCard('讨论任务', false)];
  const location = { origin: 'https://whut.ai-augmented.com',
    pathname: home ? '/app/jx-web/mycourse' : `/app/jx-web/mycourse/course/resource/folder${file ? '/file' : ''}`,
    get href() { return this.origin + this.pathname; }, assign(url) { assigned.push(url); } };
  const video = { ended, paused: false, duration: 100, currentTime: ended ? 100 : 30,
    pause() { pauses++; }, async play() {} };
  const complete = { textContent: '点我完成任务', click() { completedClicks++; } };
  const row = name => ({ querySelector() { return { textContent: name, click() { nextClicks++; }, dispatchEvent() {} }; }, querySelectorAll() { return []; } });
  const document = { title: `${firstName} | 理工智课`, body: { innerText: '' },
    querySelector(selector) {
      if (selector === '[title="点击查看/刷新待完成学习任务"]') return { click() { homeOpened = true; } };
      if (selector === 'h5.title') return { getAttribute() { return firstName; } };
      if (selector === '.ta_icon_btn .xy_btn_task_finish') return done ? {} : null;
      if (selector === 'video') return courseware ? null : video;
      if (selector === '.ant-modal .finish_task_info' && timingText !== null) return {
        textContent: timingText,
        closest() { return { querySelectorAll() { return [{ textContent: '知道了', click() { timingText = null; } }]; } }; }
      };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.ant-radio-wrapper' && homeOpened) return [{ textContent: '显示全部任务', querySelector() { return allInput; }, click() { allInput.checked = true; } }];
      if (selector === '.ant-checkbox-wrapper' && homeOpened) return [{ textContent: '仅显示可完成任务', querySelector() { return availableInput; }, click() { availableInput.checked = true; } }];
      if (selector === '.task_card .gutter-row' && homeOpened && allInput.checked) return homeCards;
      if (selector === '.group-resource-node') return [row(firstName), row('second.mp4')];
      if (selector === '.ta_icon_btn') return [complete];
      if (selector === 'video') return [video];
      return [];
    } };
  const context = vm.createContext({ document, location, window: { dispatchEvent(e) { events.push(e); } },
    Date: class extends Date { static now() { return now; } },
    CustomEvent: class { constructor(type, data) { this.type = type; this.detail = data.detail; } },
    MouseEvent: class {},
    setInterval(callback, delay) { if (delay === 1000) interval = callback; },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } },
      async sendMessage(msg) { sent.push(structuredClone(msg)); return {}; } } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'extension/task-timing.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'extension/content.js'), 'utf8'), context);
  const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
  return { sent, events, document, video, assigned,
    async start() { listener({ type: 'run', run: { id: 'run1', enabled: true, mode: home ? 'home' : 'directory', scanOnly, tasks: [], homeFinished: [], course: home ? 'previous-course' : undefined, options: { rate: 2, documentSeconds: 60, background: true, recursive: true, autoNext }, completed: [], visited: [], stack: [], logs: [] } }, {}, () => {}); await settle(); },
    async tick(ms = 6000) { now += ms; interval(); await settle(); },
    async halt() { listener({ type: 'halt' }, {}, () => {}); await settle(); },
    setDone(value) { done = value; },
    showTiming(value) { timingText = value; },
    navigate(pathname) { location.pathname = pathname; },
    get homeClicks() { return homeClicks; },
    get completedClicks() { return completedClicks; }, get nextClicks() { return nextClicks; }, get pauses() { return pauses; } };
}

test('home scan opens all tasks, filters unsupported types and does not launch resources', async () => {
  const f = fixture({ home: true, scanOnly: true }); await f.start();
  await f.tick(); await f.tick(1000); await f.tick(1000); await f.tick(3000);
  const snapshot = f.sent.filter(m => m.run?.enabled === false).at(-1)?.run;
  assert.equal(snapshot?.tasks.length, 1);
  assert.equal(snapshot?.skippedTasks, 2);
  assert.equal(f.homeClicks, 0);
});
test('home queue launches a pending task and returns home only after confirmation', async () => {
  const f = fixture({ home: true }); await f.start();
  await f.tick(); await f.tick(1000); await f.tick(1000); await f.tick(3000);
  assert.equal(f.homeClicks, 1);
  f.navigate('/app/jx-web/mycourse/another-course/resource/folder/file');
  await f.tick(); await f.tick();
  assert.equal(f.completedClicks, 1);
  assert.equal(f.assigned.length, 0);
  f.setDone(true); await f.tick();
  assert.deepEqual(f.assigned, ['https://whut.ai-augmented.com/app/jx-web/mycourse']);
  assert.equal(f.nextClicks, 0, 'home queue never drifts into directory traversal');
  assert.ok(f.sent.some(m => m.run?.homeFinished?.length === 1));
});
test('home queue pauses when the selected task never opens', async () => {
  const f = fixture({ home: true }); await f.start();
  await f.tick(); await f.tick(1000); await f.tick(1000); await f.tick(3000);
  await f.tick(16000);
  assert.equal(f.homeClicks, 1);
  assert.ok(f.sent.some(m => m.run?.enabled === false && /未成功打开/.test(m.run.status)));
});
test('disabling auto-next stops at the completed resource', async () => {
  const f = fixture({ done: true, autoNext: false }); await f.start(); await f.tick();
  assert.equal(f.nextClicks, 0);
  assert.ok(f.sent.some(m => m.run?.enabled === false && m.run.completed.length === 1));
});
test('disabling auto-next in home mode keeps the completed task open', async () => {
  const f = fixture({ home: true, autoNext: false }); await f.start();
  await f.tick(); await f.tick(1000); await f.tick(1000); await f.tick(3000);
  f.navigate('/app/jx-web/mycourse/another-course/resource/folder/file');
  await f.tick(); f.setDone(true); await f.tick();
  assert.equal(f.assigned.length, 0);
  assert.ok(f.sent.some(m => m.run?.enabled === false && m.run.completed.length === 1));
});
test('unfinished server state blocks advancement even after video ends', async () => {
  const f = fixture(); await f.start(); await f.tick();
  assert.equal(f.completedClicks, 1);
  assert.equal(f.nextClicks, 0);
  await f.tick(1000);
  assert.equal(f.completedClicks, 1, 'completion requests are rate limited');
  f.setDone(true); await f.tick();
  assert.equal(f.nextClicks, 1);
  assert.ok(f.sent.some(m => m.run?.completed?.length === 1));
});
test('courseware waits for the platform requirement minus server learned time', async () => {
  const f = fixture({ courseware: true }); await f.start(); await f.tick();
  assert.equal(f.completedClicks, 1, 'initial attempt obtains the platform rule');
  f.showTiming('已学习 17 秒，连续观看时间未达要求，至少观看 2 分钟');
  await f.tick(1000);
  await f.tick(60000);
  assert.equal(f.completedClicks, 1, 'old fixed 60 second setting has no effect');
  await f.tick(42000);
  assert.equal(f.completedClicks, 1);
  await f.tick(1000);
  assert.equal(f.completedClicks, 2, 'waits the remaining 103 seconds');
  assert.equal(f.nextClicks, 0, 'still requires platform confirmation');
  f.setDone(true); await f.tick(); assert.equal(f.nextClicks, 1);
});
test('new platform feedback replaces a previous deadline', async () => {
  const f = fixture({ courseware: true }); await f.start(); await f.tick();
  f.showTiming('已学习 10 秒，至少观看 1 分钟'); await f.tick(1000);
  await f.tick(50000); assert.equal(f.completedClicks, 2);
  f.showTiming('已学习 0 秒，连续观看时间未达要求，至少观看 5 分钟');
  await f.tick(1000); await f.tick(120000);
  assert.equal(f.completedClicks, 2, 'new five-minute requirement is respected');
});
test('unknown courseware timing pauses instead of using a default duration', async () => {
  const f = fixture({ courseware: true }); await f.start(); await f.tick();
  await f.tick(16000); await f.tick(60000);
  assert.equal(f.completedClicks, 1);
  assert.equal(f.nextClicks, 0);
  assert.ok(f.sent.some(m => m.run?.enabled === false && /未返回/.test(m.run.status)));
});
test('task timing parser supports mixed units and ignores unrelated times', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'extension/task-timing.js'), 'utf8'), context);
  assert.equal(context.xiaoyaTaskTiming('已学习 1 分 10 秒，至少观看 2 分钟').remainingSeconds, 50);
  assert.equal(context.xiaoyaTaskTiming('已学习 0 秒，至少观看 1 小时 2 分 3 秒').requiredSeconds, 3723);
  assert.equal(context.xiaoyaTaskTiming('至少观看 1.5 分钟').remainingSeconds, 90);
  assert.equal(context.xiaoyaTaskTiming('至少观看 0 秒').remainingSeconds, 0);
  assert.equal(context.xiaoyaTaskTiming('创建于 2026 年，时长 60 秒'), null);
  assert.equal(context.xiaoyaTaskTiming('至少观看足够长时间'), null);
});
test('never seeks a video or completes a video still playing', async () => {
  const f = fixture({ ended: false }); await f.start(); await f.tick();
  assert.equal(f.video.currentTime, 30);
  assert.equal(f.video.playbackRate, 2);
  assert.equal(f.completedClicks, 0);
  assert.equal(f.nextClicks, 0);
});
test('startup waits for SPA state and stopping restores background mode', async () => {
  const f = fixture({ done: true }); await f.start(); await f.tick(1000);
  assert.equal(f.nextClicks, 0);
  await f.halt(); await f.tick();
  assert.equal(f.events.at(-1).detail, false);
  assert.equal(f.pauses, 1);
  assert.equal(f.nextClicks, 0);
});
test('verification challenge stops the queue', async () => {
  const f = fixture(); await f.start(); f.document.body.innerText = '请完成人机验证'; await f.tick();
  assert.equal(f.completedClicks, 0);
  assert.ok(f.sent.some(m => m.run?.enabled === false));
});
test('background shim is reversible and does not change ordinary element blur', () => {
  const listeners = new Map();
  class Document {}
  Document.prototype.hasFocus = () => false;
  Object.defineProperty(Document.prototype, 'hidden', { get() { return true; } });
  Object.defineProperty(Document.prototype, 'visibilityState', { get() { return 'hidden'; } });
  const document = new Document();
  const window = { addEventListener(type, fn) { listeners.set(type, fn); } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'extension/background-mode.js'), 'utf8'), { Document, document, window });
  assert.equal(document.hidden, true);
  assert.equal(document.hasFocus(), false);
  listeners.get('xiaoya-helper-background')({ detail: true });
  assert.equal(document.hidden, false);
  assert.equal(document.hasFocus(), true);
  let stopped = false;
  listeners.get('blur')({ target: {}, stopImmediatePropagation() { stopped = true; } });
  assert.equal(stopped, false);
  listeners.get('blur')({ target: window, stopImmediatePropagation() { stopped = true; } });
  assert.equal(stopped, true);
  listeners.get('xiaoya-helper-background')({ detail: false });
  assert.equal(document.visibilityState, 'hidden');
  assert.equal(document.hasFocus(), false);
});
test('manifest references only files included in the extension', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  for (const name of [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap(s => s.js)]) {
    assert.ok(fs.existsSync(path.join(root, 'extension', name)), name);
  }
  assert.deepEqual(manifest.host_permissions, ['https://whut.ai-augmented.com/*']);
});
