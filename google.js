/* ============================================================
   google.js — Google integration
   - OAuth (Google Identity Services)
   - Drive: list โฟลเดอร์ + ไฟล์ Docs
   - Docs: เปิด/บันทึกไฟล์ที่เลือก (+ ตัวหนา)
   - Sheets: เก็บสถิติรายไฟล์ (date, folder, file, words, minutes)
   - เปลี่ยนบัญชีได้

   เปิด window.GoogleSync ให้ ui.js เรียก
   ============================================================ */

(function () {
  const CFG = window.APP_CONFIG || {};

  /* รูปแบบตัวอักษร/ย่อหน้า ที่จะเขียนกลับเข้า Google Doc */
  const DOC_FONT = "Calibri";
  const DOC_FONT_SIZE = 12;        // pt
  const DOC_LINE_SPACING = 115;    // % → 1.15
  const DOC_SPACE_BELOW_PT = 8;    // ช่องว่างหลังย่อหน้า (pt)

  const SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
  ].join(" ");

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = 0;
  let connected = false;
  const TOKEN_KEY = "wt_token";
  let currentEmail = null;

  const statusEl = () => document.getElementById("gStatus");
  function setStatus(msg, isError) {
    const el = statusEl();
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
  }
  const validClientId = () => CFG.CLIENT_ID && CFG.CLIENT_ID.indexOf("PASTE") === -1;
  const sheetKey = () => "wt_sheet_id::" + (currentEmail || "default");

  /* ---------- OAuth ---------- */
  let _resolveTok = null, _rejectTok = null;
  function _clearTok() { _resolveTok = null; _rejectTok = null; }
  function ensureTokenClient() {
    if (tokenClient) return true;
    if (typeof google === "undefined" || !google.accounts || !google.accounts.oauth2) return false;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.CLIENT_ID,
      scope: SCOPES,
      callback: (resp) => {
        if (resp && resp.error) { if (_rejectTok) { _rejectTok(resp); _clearTok(); } return; }
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ t: accessToken, e: tokenExpiry })); } catch (e) {}
        if (_resolveTok) { _resolveTok(accessToken); _clearTok(); }
      },
      // ยิงเมื่อ silent ล้มเหลว (เช่น ยังไม่ได้ login google / ไม่เคยอนุญาต)
      error_callback: (err) => { if (_rejectTok) { _rejectTok(err || new Error("auth error")); _clearTok(); } },
    });
    return true;
  }
  // promptMode: "" (เงียบ) | "consent" | "select_account" ; timeoutMs > 0 = ตัดจบถ้าค้าง (ใช้ตอน silent)
  function getToken(promptMode, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!ensureTokenClient()) { reject(new Error("ยังโหลด Google Identity Services ไม่เสร็จ")); return; }
      _resolveTok = resolve; _rejectTok = reject;
      try { tokenClient.requestAccessToken({ prompt: promptMode || "" }); }
      catch (e) { if (_rejectTok) { _rejectTok(e); _clearTok(); } return; }
      if (timeoutMs) setTimeout(() => { if (_rejectTok) { _rejectTok(new Error("silent timeout")); _clearTok(); } }, timeoutMs);
    });
  }
  function waitGisReady(cb, n) {
    n = n || 0;
    if (typeof google !== "undefined" && google.accounts && google.accounts.oauth2) return cb();
    if (n > 50) return;  // รอ ~5 วิ
    setTimeout(() => waitGisReady(cb, n + 1), 100);
  }

  /* ---------- fetch helper ---------- */
  async function apiFetch(url, opts, allowRetry) {
    opts = opts || {};
    if (allowRetry === undefined) allowRetry = true;
    const headers = Object.assign({}, opts.headers || {}, { Authorization: "Bearer " + accessToken });
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    if (res.status === 401 && allowRetry) { await getToken("", 8000); return apiFetch(url, opts, false); }
    if (!res.ok) { throw new Error(res.status + " " + (await res.text())); }
    return res.status === 204 ? null : res.json();
  }
  const jsonPost = (b) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const jsonPut = (b) => ({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

  async function fetchUserEmail() {
    try {
      const info = await apiFetch("https://www.googleapis.com/oauth2/v3/userinfo");
      return info && info.email ? info.email : null;
    } catch (e) { return null; }
  }

  /* ---------- Drive: โฟลเดอร์ + ไฟล์ ---------- */
  async function listFolders(filter) {
    let q = "mimeType='application/vnd.google-apps.folder' and trashed=false";
    if (filter === "mine") q += " and 'me' in owners";        // โฟลเดอร์ใน Drive ของฉันเอง
    else if (filter === "shared") q += " and sharedWithMe = true"; // โฟลเดอร์ที่คนอื่นแชร์มา
    const data = await apiFetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
      `&fields=files(id,name,ownedByMe)&orderBy=name&pageSize=500`
    );
    return (data && data.files) || [];
  }
  async function listDocs(folderId) {
    const q = encodeURIComponent(
      `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`
    );
    const data = await apiFetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=name&pageSize=500`
    );
    return (data && data.files) || [];
  }

  // ดึงเนื้อหาในโฟลเดอร์: โฟลเดอร์ย่อย + ไฟล์ Google Docs (เบราว์เซอร์แบบลำดับชั้น)
  // folderId = 'root' (ไดรฟ์ของฉัน) | 'shared' (แชร์กับฉัน) | id โฟลเดอร์จริง
  async function listChildren(folderId) {
    const FOLDER = "mimeType='application/vnd.google-apps.folder'";
    const DOC = "mimeType='application/vnd.google-apps.document'";
    let q;
    if (folderId === "shared") {
      q = `sharedWithMe = true and trashed = false and (${FOLDER} or ${DOC})`;
    } else {
      q = `'${folderId}' in parents and trashed = false and (${FOLDER} or ${DOC})`;
    }
    const data = await apiFetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
      `&fields=files(id,name,mimeType)&orderBy=folder,name&pageSize=1000`
    );
    const files = (data && data.files) || [];
    const folders = files
      .filter((f) => f.mimeType === "application/vnd.google-apps.folder")
      .map((f) => ({ id: f.id, name: f.name }));
    const docs = files
      .filter((f) => f.mimeType === "application/vnd.google-apps.document")
      .map((f) => ({ id: f.id, name: f.name }));
    return { folders, docs };
  }

  // ลบไฟล์/โฟลเดอร์ (ย้ายไปถังขยะ — กู้คืนได้ใน Google Drive)
  async function trashFile(fileId) {
    return apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  }
  // เปลี่ยนชื่อไฟล์/โฟลเดอร์
  async function renameFile(fileId, name) {
    return apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }
  // สร้างโฟลเดอร์ใหม่ในโฟลเดอร์แม่
  async function createFolder(parentId, name) {
    return apiFetch(
      "https://www.googleapis.com/drive/v3/files?fields=id,name",
      jsonPost({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] })
    );
  }
  // สร้างไฟล์ Google Doc เปล่าในโฟลเดอร์แม่
  async function createDoc(parentId, name) {
    return apiFetch(
      "https://www.googleapis.com/drive/v3/files?fields=id,name",
      jsonPost({ name, mimeType: "application/vnd.google-apps.document", parents: [parentId] })
    );
  }

  /* ---------- Docs: เปิด / บันทึก ---------- */
  function parseDoc(doc) {
    let text = "";
    const ranges = [];
    const aligns = [];   // align ต่อย่อหน้า (1 ย่อหน้า = 1 บรรทัด)
    (doc.body.content || []).forEach((el) => {
      if (el.paragraph) {
        const ps = el.paragraph.paragraphStyle || {};
        aligns.push(ps.alignment === "CENTER" ? "center" : "left");
        (el.paragraph.elements || []).forEach((pe) => {
          if (pe.textRun) {
            const t = pe.textRun.content || "";
            const bold = !!(pe.textRun.textStyle && pe.textRun.textStyle.bold);
            const start = text.length;
            text += t;
            if (bold) ranges.push([start, text.length]);
          }
        });
      }
    });
    if (text.endsWith("\n")) text = text.slice(0, -1);
    return { text, ranges, aligns };
  }
  // ถ้าไฟล์เป็นตัวหนาเกือบทั้งไฟล์ ถือว่าเพี้ยนจากบั๊กเดิม → ล้างตัวหนาทิ้ง
  function normalizeBold(parsed) {
    const { text, ranges, aligns } = parsed;
    const nonWs = (text.match(/\S/g) || []).length;
    if (!nonWs) return { text, ranges, aligns, normalized: false };
    let boldNonWs = 0;
    ranges.forEach(([s, e]) => {
      for (let i = s; i < e && i < text.length; i++) if (/\S/.test(text[i])) boldNonWs++;
    });
    if (boldNonWs >= nonWs * 0.95) {
      console.warn("ไฟล์นี้ตัวหนาเกือบทั้งไฟล์ — ล้างตัวหนาอัตโนมัติ (น่าจะเพี้ยนจากบั๊กเดิม)");
      return { text, ranges: [], aligns, normalized: true };
    }
    return { text, ranges, aligns, normalized: false };
  }

  async function openDoc(fileId) {
    const doc = await apiFetch(`https://docs.googleapis.com/v1/documents/${fileId}`);
    return normalizeBold(parseDoc(doc));
  }
  async function saveDoc(fileId, text, ranges, aligns) {
    const doc = await apiFetch(`https://docs.googleapis.com/v1/documents/${fileId}`);
    const content = doc.body.content || [];
    const endIndex = content.length ? content[content.length - 1].endIndex : 1;
    const requests = [];
    if (endIndex - 1 > 1) {
      requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
    }
    if (text && text.length > 0) {
      const L = text.length;
      requests.push({ insertText: { location: { index: 1 }, text } });

      // 1) base style ทั้งก้อน: ฟอนต์ Calibri 12 + ล้างตัวหนาเป็น false
      //    (สำคัญ: ล้าง bold ทั้งหมดก่อน ไม่งั้นข้อความที่แทรกจะ inherit ตัวหนามาทั้งไฟล์)
      requests.push({
        updateTextStyle: {
          range: { startIndex: 1, endIndex: 1 + L },
          textStyle: {
            weightedFontFamily: { fontFamily: DOC_FONT },
            fontSize: { magnitude: DOC_FONT_SIZE, unit: "PT" },
            bold: false,
          },
          fields: "weightedFontFamily,fontSize,bold",
        },
      });

      // 2) ตัวหนาเฉพาะช่วงที่ผู้ใช้ทำตัวหนาในเว็บ
      (ranges || []).forEach(([s, e]) => {
        requests.push({
          updateTextStyle: {
            range: { startIndex: 1 + s, endIndex: 1 + e },
            textStyle: { bold: true },
            fields: "bold",
          },
        });
      });

      // 3) ย่อหน้าทั้งหมด: line spacing 1.15 + ช่องว่างหลังย่อหน้า + จัดชิดซ้าย (reset)
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: 1, endIndex: 1 + L },
          paragraphStyle: {
            lineSpacing: DOC_LINE_SPACING,
            spaceBelow: { magnitude: DOC_SPACE_BELOW_PT, unit: "PT" },
            alignment: "START",
          },
          fields: "lineSpacing,spaceBelow,alignment",
        },
      });

      // 4) ย่อหน้าที่จัดกึ่งกลาง → ตั้ง alignment CENTER เฉพาะบรรทัดนั้น
      if (aligns && aligns.length) {
        const textLines = text.split("\n");
        let off = 0;
        textLines.forEach((ln, i) => {
          const start = off;
          off += ln.length + 1; // +1 = \n
          if (aligns[i] === "center") {
            const len = ln.length > 0 ? ln.length : 1;
            requests.push({
              updateParagraphStyle: {
                range: { startIndex: 1 + start, endIndex: 1 + start + len },
                paragraphStyle: { alignment: "CENTER" },
                fields: "alignment",
              },
            });
          }
        });
      }
    }
    if (requests.length) {
      await apiFetch(`https://docs.googleapis.com/v1/documents/${fileId}:batchUpdate`, jsonPost({ requests }));
    }
  }

  /* ---------- Sheets: สถิติรายไฟล์ (ผูกกับบัญชี ข้ามเครื่องได้) ---------- */
  // schema: A=date B=folder_id C=file_id D=file_name E=word_count F=minutes
  let goalsTabReady = false;
  async function ensureSheet() {
    let id = localStorage.getItem(sheetKey());
    if (id) return id;

    // 1) ค้นหา Sheet เดิมใน Drive ตามชื่อก่อน (ทำให้เครื่องอื่นเจอชีตเดิม → สถิติไม่หาย)
    const q = `name = '${CFG.SHEET_TITLE.replace(/'/g, "\\'")}' ` +
      `and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and 'me' in owners`;
    try {
      const found = await apiFetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&orderBy=createdTime`
      );
      if (found && found.files && found.files.length) {
        id = found.files[0].id;
        localStorage.setItem(sheetKey(), id);
        return id;
      }
    } catch (e) { console.warn("ค้นหา Sheet เดิมไม่สำเร็จ:", e); }

    // 2) ไม่เจอ → สร้างใหม่ (พร้อม tab stats + goals)
    const ss = await apiFetch(
      "https://sheets.googleapis.com/v4/spreadsheets",
      jsonPost({
        properties: { title: CFG.SHEET_TITLE },
        sheets: [{ properties: { title: "stats" } }, { properties: { title: "goals" } }],
      })
    );
    id = ss.spreadsheetId;
    localStorage.setItem(sheetKey(), id);
    await apiFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/stats!A1:F1?valueInputOption=RAW`,
      jsonPut({ values: [["date", "folder_id", "file_id", "file_name", "word_count", "minutes"]] })
    );
    await apiFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/goals!A1:F1?valueInputOption=RAW`,
      jsonPut({ values: [["folder_id", "target", "days", "created", "last_total", "last_counted"]] })
    );
    goalsTabReady = true;
    return id;
  }

  // ทำให้แน่ใจว่ามี tab "goals" (สำหรับชีตเก่าที่สร้างก่อนมีฟีเจอร์เป้า)
  async function ensureGoalsTab(spreadsheetId) {
    if (goalsTabReady) return;
    const meta = await apiFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`
    );
    const has = (meta.sheets || []).some((s) => s.properties.title === "goals");
    if (!has) {
      await apiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        jsonPost({ requests: [{ addSheet: { properties: { title: "goals" } } }] })
      );
      await apiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/goals!A1:F1?valueInputOption=RAW`,
        jsonPut({ values: [["folder_id", "target", "days", "created", "last_total", "last_counted"]] })
      );
    }
    goalsTabReady = true;
  }

  // โหลดเป้าทั้งหมด (เรียกครั้งเดียวตอนเชื่อมต่อ) → { folderId: {target,days,...} }
  async function loadGoals() {
    const id = await ensureSheet();
    let data;
    try {
      data = await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/goals!A2:F`);
      goalsTabReady = true;
    } catch (e) {
      await ensureGoalsTab(id);   // ยังไม่มี tab goals
      return {};
    }
    const map = {};
    (data && data.values || []).forEach((r) => {
      if (r[0]) map[r[0]] = {
        target: Number(r[1] || 0), days: Number(r[2] || 0), created: r[3] || "",
        lastTotal: Number(r[4] || 0), lastCounted: r[5] || "",
      };
    });
    return map;
  }

  async function saveGoalRow(folderId, g) {
    const id = await ensureSheet();
    await ensureGoalsTab(id);
    const data = await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/goals!A2:F`);
    const rows = (data && data.values) || [];
    let rowNum = -1;
    for (let i = 0; i < rows.length; i++) { if (rows[i][0] === folderId) { rowNum = i + 2; break; } }
    const values = [[folderId, g.target, g.days, g.created || "", g.lastTotal || 0, g.lastCounted || ""]];
    if (rowNum > 0) {
      await apiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/goals!A${rowNum}:F${rowNum}?valueInputOption=RAW`,
        jsonPut({ values })
      );
    } else {
      await apiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/goals!A:F:append?valueInputOption=RAW`,
        jsonPost({ values })
      );
    }
  }

  async function deleteGoalRow(folderId) {
    const id = await ensureSheet();
    const data = await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/goals!A2:F`);
    const remaining = ((data && data.values) || []).filter((r) => r[0] !== folderId);
    await apiFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/goals!A2:F:clear`,
      jsonPost({})
    );
    if (remaining.length) {
      await apiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/goals!A2?valueInputOption=RAW`,
        jsonPut({ values: remaining })
      );
    }
  }

  async function readRows() {
    const id = await ensureSheet();
    const data = await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/stats!A2:F`);
    return { id, rows: (data && data.values) || [] };
  }

  async function upsertStat(s) {
    if (!connected) return;
    try {
      const { id, rows } = await readRows();
      let rowNum = -1;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === s.date && rows[i][2] === s.fileId) { rowNum = i + 2; break; }
      }
      const values = [[s.date, s.folderId, s.fileId, s.fileName, s.wordCount, Math.round(s.minutes * 10) / 10]];
      if (rowNum > 0) {
        await apiFetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/stats!A${rowNum}:F${rowNum}?valueInputOption=RAW`,
          jsonPut({ values })
        );
      } else {
        await apiFetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/stats!A:F:append?valueInputOption=RAW`,
          jsonPost({ values })
        );
      }
    } catch (e) { console.error("upsertStat error:", e); }
  }

  async function getTodayMinutes(fileId) {
    try {
      const { rows } = await readRows();
      const today = window.WT.todayKey();
      for (const r of rows) {
        if (r[0] === today && r[2] === fileId) return Number(r[5] || 0);
      }
    } catch (e) { console.warn("getTodayMinutes:", e); }
    return 0;
  }

  async function getFolderStats(folderId) {
    const { rows } = await readRows();
    return rows
      .filter((r) => r[1] === folderId)
      .map((r) => ({
        date: r[0], folderId: r[1], fileId: r[2], fileName: r[3],
        wordCount: Number(r[4] || 0), minutes: Number(r[5] || 0),
      }));
  }

  // สถิติของไฟล์เดียว (ทุกวันที่)
  async function getFileStats(fileId) {
    const { rows } = await readRows();
    return rows
      .filter((r) => r[2] === fileId)
      .map((r) => ({ date: r[0], wordCount: Number(r[4] || 0), minutes: Number(r[5] || 0) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /* ---------- เชื่อมต่อ / เปลี่ยนบัญชี ---------- */
  function markConnected() {
    connected = true;
    document.getElementById("connectBtn").textContent = "เชื่อมต่อแล้ว ✓";
    const sb = document.getElementById("switchBtn");
    if (sb) sb.style.display = "";
  }

  async function connect(promptMode) {
    if (!validClientId()) { alert("ยังไม่ได้ใส่ CLIENT_ID ใน config.js"); return; }
    try {
      setStatus("กำลังขออนุญาต...");
      await getToken(promptMode || "consent");
      currentEmail = await fetchUserEmail();
      await ensureSheet();
      markConnected();
      setStatus("เชื่อมต่อแล้ว · " + (currentEmail || ""));
      if (window.UI && window.UI.onConnected) window.UI.onConnected();
    } catch (e) {
      console.error("connect error:", e);
      connected = false;
      const msg = e && e.message ? e.message : String(e);
      setStatus("เชื่อมต่อไม่สำเร็จ: " + msg.slice(0, 200), true);
    }
  }

  // กู้ session จาก token ที่เก็บไว้ (ตอนเปิด/รีเฟรช) — ไม่เด้ง popup
  async function restoreSession() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(TOKEN_KEY)); } catch (e) {}
    if (!saved || !saved.t || !saved.e || saved.e - Date.now() < 60000) {
      setStatus("ยังไม่เชื่อมต่อ Google");
      return;
    }
    accessToken = saved.t; tokenExpiry = saved.e;
    setStatus("กำลังเชื่อมต่อกลับ...");
    try {
      // ตรวจ token ด้วย userinfo แบบ "ไม่ retry" → ถ้า token เสียจะ throw เฉยๆ ไม่เด้ง popup
      const info = await apiFetch("https://www.googleapis.com/oauth2/v3/userinfo", {}, false);
      currentEmail = info && info.email;
      if (!currentEmail) throw new Error("token ใช้ไม่ได้");
      await ensureSheet();
      markConnected();
      setStatus("เชื่อมต่อแล้ว · " + currentEmail);
      if (window.UI && window.UI.onConnected) window.UI.onConnected();
    } catch (e) {
      accessToken = null; connected = false;
      try { localStorage.removeItem(TOKEN_KEY); } catch (e2) {}
      setStatus("ยังไม่เชื่อมต่อ Google");
    }
  }
  async function switchAccount() {
    accessToken = null; connected = false; currentEmail = null;
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(sheetKey()); } catch (e) {}
    setStatus("กำลังเปลี่ยนบัญชี...");
    await connect("select_account");
  }

  window.GoogleSync = {
    isConnected: () => connected,
    connect: () => connect("consent"),
    switchAccount,
    listFolders, listDocs, listChildren,
    renameFile, trashFile, createFolder, createDoc,
    openDoc, saveDoc,
    upsertStat, getTodayMinutes, getFolderStats, getFileStats,
    loadGoals, saveGoalRow, deleteGoalRow,
  };

  document.addEventListener("DOMContentLoaded", () => {
    const cb = document.getElementById("connectBtn");
    if (cb) cb.addEventListener("click", () => connect("consent"));
    const sb = document.getElementById("switchBtn");
    if (sb) sb.addEventListener("click", switchAccount);
    // กู้ session จาก token ที่เก็บไว้ (รีเฟรช/เปิดใหม่ภายในอายุ token → ต่อเองไม่ต้องกด ไม่มี popup)
    if (validClientId()) restoreSession();
    else setStatus("ยังไม่ได้ตั้งค่า CLIENT_ID");
  });
})();
