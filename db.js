/**
 * nogdigi ローカルDB層
 *
 * - 起動時に data/snapshot.sqlite を sql.js (WASM SQLite) にロード
 * - 編集 (INSERT/UPDATE/DELETE) は IndexedDB に追記ログとして永続化
 * - リロード時はスナップショット読み直し→IDB ログを順次リプレイして編集状態を復元
 *
 * window.queryTurso / window.executeTurso を上書きし、app.js から透過的に使える。
 */
(function () {
    'use strict';

    const SQL_JS_BASE = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/';
    const SNAPSHOT_PATH = 'data/snapshot.sqlite';
    const IDB_NAME = 'nogdigi';
    const IDB_STORE = 'writes';
    const IDB_VERSION = 1;

    let db = null;

    function openIDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = () => {
                const idb = req.result;
                if (!idb.objectStoreNames.contains(IDB_STORE)) {
                    idb.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function getAllWrites() {
        const idb = await openIDB();
        return new Promise((resolve, reject) => {
            const tx = idb.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function appendWrite(entry) {
        const idb = await openIDB();
        return new Promise((resolve, reject) => {
            const tx = idb.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).add(entry);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function clearWrites() {
        const idb = await openIDB();
        return new Promise((resolve, reject) => {
            const tx = idb.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    function isWrite(sql) {
        return /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i.test(sql);
    }

    window.dbReady = (async () => {
        const SQL = await initSqlJs({ locateFile: f => SQL_JS_BASE + f });
        // 5分毎にGitHub Actionsで更新されるsnapshotを毎回最新で取りに行く
        const cacheBust = Math.floor(Date.now() / 60000); // 1分粒度
        const resp = await fetch(`${SNAPSHOT_PATH}?v=${cacheBust}`, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`snapshot.sqlite fetch failed: ${resp.status}`);
        const buf = await resp.arrayBuffer();
        db = new SQL.Database(new Uint8Array(buf));

        // ローカル編集をリプレイ
        const writes = await getAllWrites();
        let replayed = 0;
        let failed = 0;
        for (const entry of writes) {
            try {
                const stmt = db.prepare(entry.sql);
                stmt.bind(entry.args || []);
                stmt.step();
                stmt.free();
                replayed++;
            } catch (e) {
                failed++;
                console.warn('[nogdigi] replay failed:', e.message, entry);
            }
        }
        console.log(`[nogdigi] DB ready. Replayed ${replayed} writes (${failed} failed).`);
        return db;
    })().catch(e => {
        console.error('[nogdigi] DB init failed:', e);
        alert('DB初期化に失敗しました: ' + e.message);
        throw e;
    });

    async function runQuery(sql, args = []) {
        await window.dbReady;
        const stmt = db.prepare(sql);
        try {
            stmt.bind(args || []);
            const rows = [];
            while (stmt.step()) {
                rows.push(stmt.getAsObject());
            }
            return rows;
        } finally {
            stmt.free();
        }
    }

    window.queryTurso = async function (sql, args = []) {
        const rows = await runQuery(sql, args);
        if (isWrite(sql)) {
            await appendWrite({ sql, args, ts: Date.now() });
        }
        return rows;
    };

    window.executeTurso = window.queryTurso;

    // ローカル編集をすべて破棄（スナップショットの状態に戻す）
    window.nogdigiResetLocalChanges = async function () {
        if (!confirm('ローカルの全編集を破棄してスナップショットの状態に戻します。よろしいですか？')) return;
        await clearWrites();
        location.reload();
    };

    // SQLite を Blob として書き出してダウンロード
    window.nogdigiExportDb = function () {
        if (!db) { alert('DB未初期化'); return; }
        const data = db.export();
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nogdigi_${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
        a.click();
        URL.revokeObjectURL(url);
    };
})();
