/**
 * e2e 36：后端总线名冲突探测（方案 B：运行时版本检测，backendInfo.js）。
 * 直接测试 queryBackendConflict 的分类逻辑：
 * - 同版本占名者 → sameVersion（harness 自身 portal 后端）；
 * - 旧版本占名者（Version 属性值不同）→ outdated + remoteVersion；
 * - 无 Version 属性的占名者（更旧构建）→ noVersion；
 * - 名字无主 → null（无冲突，不进报告）。
 * 假后端用进程级随机总线名注册（不抢标准名/真实应用名）。
 * unresponsive（僵尸占名）依赖不回复的对端，e2e 无法稳定伪造，略
 * （超时路径已在本机真实残留名上人工验证）。
 * 无会话总线时打印 SKIP 跳过（不判失败）。
 */
const h = require('./harness.cjs');
const path = require('path');
const { app } = require('electron');
const { BACKEND_VERSION_PROPERTY, queryBackendConflict } = require(
  path.join(h.DIST_ELECTRON, 'handlers', 'backendInfo.js'),
);

const FAKE_PATH = '/org/hoshineko/e2e/conflict';
const FAKE_IFACE = 'org.hoshineko.e2e.Conflict';

(async () => {
  await h.setupApp();

  let dbus = null;
  try {
    dbus = require('dbus-next');
    dbus.sessionBus();
  } catch {
    console.log('  - 36 跳过（无会话总线）');
    h.finish();
    return;
  }

  await h.run('36 后端总线名冲突探测', async () => {
    const reg = await h.getBackendRegistration();
    h.assert.strictEqual(reg.portal, true, '本进程 portal 后端注册应成功');

    // 1) 同版本：探测 harness 自身的 portal 后端（同进程 app.getVersion()）
    const same = await queryBackendConflict(h.E2E_PORTAL_BUS_NAME, '/org/freedesktop/portal/desktop', 'org.freedesktop.impl.portal.FileChooser');
    h.assert.ok(same, '同版本后端探测应有结果');
    h.assert.strictEqual(same.state, 'sameVersion', '同版本后端应为 sameVersion');
    h.assert.strictEqual(same.remoteVersion, app.getVersion(), 'remoteVersion 应等于本进程版本');

    // 2) 旧版本：注册 Version='0.0.0-e2e-old' 的假后端（进程级随机名）
    const oldBus = dbus.sessionBus();
    const oldName = `org.hoshineko.e2e.conflict.old.p${process.pid}`;
    h.assert.strictEqual(await oldBus.requestName(oldName, dbus.NameFlag.DO_NOT_QUEUE), 1, '旧版假后端应成功取得名字');
    const { Interface } = dbus.interface;
    class OldBackend extends Interface {
      constructor() {
        super(FAKE_IFACE);
      }

      get [BACKEND_VERSION_PROPERTY]() {
        return '0.0.0-e2e-old';
      }
    }
    OldBackend.configureMembers({
      properties: { [BACKEND_VERSION_PROPERTY]: { signature: 's', access: 'read' } },
    });
    oldBus.export(FAKE_PATH, new OldBackend());

    const outdated = await queryBackendConflict(oldName, FAKE_PATH, FAKE_IFACE);
    h.assert.ok(outdated, '旧版本占名者探测应有结果');
    h.assert.strictEqual(outdated.state, 'outdated', '版本不同应为 outdated');
    h.assert.strictEqual(outdated.remoteVersion, '0.0.0-e2e-old', '应回传占名者版本号');

    // 3) 无版本属性：注册不带 Version 属性的假后端（更旧构建形态）
    const plainBus = dbus.sessionBus();
    const plainName = `org.hoshineko.e2e.conflict.plain.p${process.pid}`;
    h.assert.strictEqual(await plainBus.requestName(plainName, dbus.NameFlag.DO_NOT_QUEUE), 1, '无版本假后端应成功取得名字');
    class PlainBackend extends Interface {
      constructor() {
        super(FAKE_IFACE);
      }

      async Ping() {
        return;
      }
    }
    PlainBackend.configureMembers({
      methods: { Ping: { inSignature: '', outSignature: '' } },
    });
    plainBus.export(FAKE_PATH, new PlainBackend());

    const noVersion = await queryBackendConflict(plainName, FAKE_PATH, FAKE_IFACE);
    h.assert.ok(noVersion, '无版本属性占名者探测应有结果');
    h.assert.strictEqual(noVersion.state, 'noVersion', '无 Version 属性应为 noVersion');
    h.assert.strictEqual(noVersion.remoteVersion, undefined, 'noVersion 不应有 remoteVersion');

    // 4) 名字无主：探测应返回 null（无冲突，不进报告）
    const free = await queryBackendConflict(`org.hoshineko.e2e.conflict.free.p${process.pid}`, FAKE_PATH, FAKE_IFACE);
    h.assert.strictEqual(free, null, '名字无主应返回 null');

    // 显式断开假后端总线（历史：usocket 收尾竞态曾使此步偶发退出挂起，
    // 移除 usocket 后 dbus-next 走 net.Socket，收尾无竞态）
    oldBus.disconnect();
    plainBus.disconnect();
  });

  h.finish();
})();
