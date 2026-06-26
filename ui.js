/* ============================================================
   ui.js — Orchestration
   - สลับหน้า sidebar (เขียน / dashboard)
   - หน้าเขียน: เลือกโฟลเดอร์ → ไฟล์ → editor
   - dashboard: เลือกโฟลเดอร์ → 3 กราฟ
   ใช้ window.WT (editor) + window.GoogleSync (google)
   ============================================================ */

(function () {
  const G = () => window.GoogleSync;

  let curFolderId = null, curFolderName = "", curFileId = null, curFileName = "";
  let pickerRoot = "mine";   // 'mine' (ไดรฟ์ของฉัน) | 'shared' (แชร์กับฉัน)
  let pathStack = [];        // เส้นทางโฟลเดอร์ปัจจุบัน [{id, name}]
  let pickerDetail = false;  // false = ไอคอน, true = รายละเอียด (ชื่อเต็ม)
  let lastChildren = { folders: [], docs: [] };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function rootEntry() {
    return pickerRoot === "shared"
      ? { id: "shared", name: "แชร์กับฉัน" }
      : { id: "root", name: "ไดรฟ์ของฉัน" };
  }

  /* ============================================================
     History — ผูกการนำทางเข้ากับปุ่ม back/forward ของเบราว์เซอร์
     ============================================================ */
  let curState = null;

  function domShowView(name) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    $("view-" + name).classList.add("active");
    const nav = document.querySelector(`.nav-item[data-view="${name}"]`);
    if (nav) nav.classList.add("active");
    const hb = $("headbarTitle");
    if (hb) hb.textContent = name === "dashboard" ? "Dashboard" : "Writing";
  }

  function writeBrowseState() {
    return { view: "write", root: pickerRoot, path: pathStack.map((p) => ({ id: p.id, name: p.name })), editing: false };
  }

  function pushNav(state) { history.pushState(state, ""); applyState(state); }
  function replaceNav(state) { history.replaceState(state, ""); curState = state; }

  // เรนเดอร์ตาม state (ใช้ทั้งตอนนำทาง และตอนกด back/forward ของเบราว์เซอร์)
  function applyState(s) {
    curState = s;
    // sprint อยู่เฉพาะหน้าเขียนไฟล์ — ออกไปหน้าอื่น (picker/dashboard) ให้ยกเลิก
    if (window.WT && window.WT.cancelSprint && !(s && s.view === "write" && s.editing)) {
      window.WT.cancelSprint();
    }
    if (s && s.view === "dashboard") {
      domShowView("dashboard");
      initDashboard();
      return;
    }
    domShowView("write");
    pickerRoot = (s && s.root) || "mine";
    document.querySelectorAll("#folderFilter .seg-btn").forEach((x) =>
      x.classList.toggle("active", x.dataset.filter === pickerRoot));
    pathStack = (s && s.path && s.path.length) ? s.path.map((p) => ({ ...p })) : [rootEntry()];
    if (!G() || !G().isConnected()) { renderDisconnected(); return; }
    if (s && s.editing && s.fileId) openFile(s.fileId, s.fileName);
    else renderBrowse();
  }

  window.addEventListener("popstate", (e) => {
    const target = e.state || writeBrowseState();
    const leavingEdit = curState && curState.view === "write" && curState.editing;
    const sameFile = target.view === "write" && target.editing && target.fileId === (curState && curState.fileId);
    if (leavingEdit && !sameFile && window.WT.isDirty && window.WT.isDirty()) {
      if (!confirm("ยังมีการแก้ไขที่ยังไม่ได้บันทึก\nออกโดยไม่บันทึกหรือไม่?")) {
        history.pushState(curState, "");  // ดันสถานะเดิมกลับ เพื่ออยู่ต่อ
        return;
      }
    }
    applyState(target);
  });

  /* ---------- nav sidebar ---------- */
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.view;
      pushNav(name === "dashboard" ? { view: "dashboard" } : writeBrowseState());
    });
  });
  // ชื่อเว็บ (มุมบนซ้าย) → กลับหน้าแรกเสมอ (หน้าเขียน รากไดรฟ์ของฉัน)
  const brandHome = $("brandHome");
  if (brandHome) brandHome.addEventListener("click", () => {
    pickerRoot = "mine";
    pathStack = [rootEntry()];
    pushNav(writeBrowseState());
  });

  /* ---------- หน้าเขียน: เบราว์เซอร์โฟลเดอร์แบบลำดับชั้น (เหมือน Google Drive) ---------- */
  function renderBreadcrumb() {
    $("breadcrumb").innerHTML = pathStack
      .map((p, i) => `<span class="crumb" data-i="${i}">${esc(p.name)}</span>`)
      .join(' <span class="sep">›</span> ');
    $("breadcrumb").querySelectorAll(".crumb").forEach((c) => {
      c.addEventListener("click", () => {
        pathStack = pathStack.slice(0, Number(c.dataset.i) + 1);  // ย้อนไปชั้นที่กด
        pushNav(writeBrowseState());
      });
    });
  }

  function renderDisconnected() {
    $("writeEditor").hidden = true;
    $("writePicker").hidden = false;
    $("folderFilter").style.display = "none";
    $("pickerSelectBtn").style.display = "none";
    $("folderGoalBtn").style.display = "none";
    $("folderGoalPanel").hidden = true;
    $("addBtn").style.display = "none";
    $("createMenu").hidden = true;
    $("pickerHint").textContent = "เชื่อมต่อ Google ก่อนเพื่อโหลดโฟลเดอร์จาก Drive";
    $("pickerHint").style.display = "";
    $("pickerList").innerHTML = "";
    $("breadcrumb").innerHTML = "";
  }

  function showWritePicker() {
    if (!G() || !G().isConnected()) { renderDisconnected(); return; }
    pathStack = [rootEntry()];
    replaceNav(writeBrowseState());   // ตั้งเป็น history entry ฐาน
    domShowView("write");
    renderBrowse();
  }

  // แสดงเนื้อหาของโฟลเดอร์ปัจจุบัน (โฟลเดอร์ย่อย + ไฟล์ Docs) — ไม่ยุ่งกับ history
  async function renderBrowse() {
    $("writeEditor").hidden = true;
    $("writePicker").hidden = false;
    $("folderFilter").style.display = "";
    pickerDetail = false;                          // เข้าโฟลเดอร์ใหม่ → เริ่มที่มุมมองไอคอน
    const cur = pathStack[pathStack.length - 1];
    renderBreadcrumb();
    $("pickerSelectBtn").style.display = "none";
    $("folderGoalBtn").style.display = "none";
    $("folderGoalPanel").hidden = true;
    $("addBtn").style.display = "none";
    $("createMenu").hidden = true;
    $("pickerHint").textContent = "กำลังโหลด...";
    $("pickerHint").style.display = "";
    $("pickerList").className = "picker-list";
    $("pickerList").innerHTML = "";
    try {
      lastChildren = await G().listChildren(cur.id);
      $("addBtn").style.display = cur.id === "shared" ? "none" : "";  // สร้างได้แม้โฟลเดอร์ว่าง (ยกเว้นราก "แชร์กับฉัน")
      if (!lastChildren.folders.length && !lastChildren.docs.length) {
        $("pickerHint").textContent = "โฟลเดอร์นี้ว่าง — กด “+ ใหม่” เพื่อสร้างไฟล์/โฟลเดอร์";
        return;
      }
      $("pickerHint").style.display = "none";
      $("pickerSelectBtn").style.display = "";     // มีเนื้อหา → โชว์ปุ่มเลือก
      $("folderGoalBtn").style.display = "";
      renderPickerList();
      renderGoalForFolder();                        // ถ้าโฟลเดอร์นี้มีเป้า → แสดง progress
    } catch (e) {
      console.error(e);
      $("pickerHint").textContent = "โหลดไม่สำเร็จ: " + (e.message || e);
    }
  }

  // เรนเดอร์รายการ (ไอคอน หรือ รายละเอียด) จาก lastChildren
  function pickItemHtml(type, id, name, icon) {
    return `<div class="pick-item ${type}" data-type="${type}" data-id="${esc(id)}" data-name="${esc(name)}">` +
      `<span class="pick-name">${icon} ${esc(name)}</span>` +
      `<div class="item-menu-root">` +
        `<button class="pick-menu" title="ตัวเลือก">⋯</button>` +
        `<div class="item-menu menu-content" hidden>` +
          `<button class="menu-item" data-act="rename">✏️ เปลี่ยนชื่อ</button>` +
          `<button class="menu-item danger" data-act="delete">🗑️ ลบ</button>` +
        `</div>` +
      `</div></div>`;
  }
  function closeAllItemMenus() {
    document.querySelectorAll(".item-menu").forEach((m) => (m.hidden = true));
  }
  function renderPickerList() {
    const { folders, docs } = lastChildren;
    const html =
      folders.map((f) => pickItemHtml("folder", f.id, f.name, "📁")).join("") +
      docs.map((d) => pickItemHtml("doc", d.id, d.name, "📄")).join("");
    $("pickerList").className = "picker-list" + (pickerDetail ? " detail" : "");
    $("pickerList").innerHTML = html;
    $("pickerSelectBtn").textContent = pickerDetail ? "Icon" : "Detail";
    $("pickerList").querySelectorAll(".pick-item").forEach((el) => {
      el.querySelector(".pick-name").addEventListener("click", () => {
        if (el.dataset.type === "folder") {
          pathStack.push({ id: el.dataset.id, name: el.dataset.name });
          pushNav(writeBrowseState());
        } else {
          pushNav({
            view: "write", root: pickerRoot,
            path: pathStack.map((p) => ({ id: p.id, name: p.name })),
            editing: true, fileId: el.dataset.id, fileName: el.dataset.name,
          });
        }
      });
      // ⋯ เปิดเมนู (เปลี่ยนชื่อ / ลบ)
      const menu = el.querySelector(".item-menu");
      el.querySelector(".pick-menu").addEventListener("click", (e) => {
        e.stopPropagation();
        const wasHidden = menu.hidden;
        closeAllItemMenus();
        menu.hidden = !wasHidden;
      });
      el.querySelectorAll(".item-menu .menu-item").forEach((mi) => {
        mi.addEventListener("click", (e) => {
          e.stopPropagation();
          menu.hidden = true;
          if (mi.dataset.act === "rename") startInlineRename(el);
          else if (mi.dataset.act === "delete") deleteItem(el);
        });
      });
    });
  }

  async function deleteItem(el) {
    const label = el.dataset.type === "folder" ? "โฟลเดอร์" : "ไฟล์";
    if (!confirm(`ลบ${label} “${el.dataset.name}” ?\n(ย้ายไปถังขยะใน Google Drive — กู้คืนได้ภายหลัง)`)) return;
    try { await G().trashFile(el.dataset.id); renderBrowse(); }
    catch (e) { console.error(e); alert("ลบไม่สำเร็จ: " + (e.message || e)); }
  }

  // แก้ชื่อในกล่อง text ตรงรายการเลย (ไม่ใช้ prompt/dialog)
  function startInlineRename(el) {
    const id = el.dataset.id, oldName = el.dataset.name;
    el.classList.add("editing");
    el.innerHTML = "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "rename-input";
    input.value = oldName;
    el.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const commit = async () => {
      if (done) return; done = true;
      const newName = input.value.trim();
      if (!newName || newName === oldName) { renderPickerList(); return; }
      try { await G().renameFile(id, newName); renderBrowse(); }
      catch (err) { console.error(err); alert("เปลี่ยนชื่อไม่สำเร็จ: " + (err.message || err)); renderPickerList(); }
    };
    const cancel = () => { if (done) return; done = true; renderPickerList(); };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); commit(); }
      else if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
    });
    input.addEventListener("blur", commit);
  }

  // ปุ่ม "Detail/Icon" → สลับมุมมอง (เห็นชื่อไฟล์เต็ม)
  if ($("pickerSelectBtn")) $("pickerSelectBtn").addEventListener("click", () => {
    pickerDetail = !pickerDetail;
    renderPickerList();
  });

  /* ---------- เป้าการเขียนระดับโฟลเดอร์ (เก็บใน Google Sheet ผูกกับบัญชี) ---------- */
  let goalsMap = {};   // โหลดครั้งเดียวตอนเชื่อมต่อ → cache ในหน่วยความจำ
  const getGoal = (fid) => goalsMap[fid] || null;
  function setGoal(fid, g) {
    goalsMap[fid] = g;
    if (G() && G().isConnected()) G().saveGoalRow(fid, g).catch((e) => console.error("saveGoal:", e));
  }
  function delGoal(fid) {
    delete goalsMap[fid];
    if (G() && G().isConnected()) G().deleteGoalRow(fid).catch((e) => console.error("delGoal:", e));
  }
  const curFid = () => (pathStack.length ? pathStack[pathStack.length - 1].id : null);

  function renderGoalForFolder() {
    const g = getGoal(curFid());
    $("goalSetup").hidden = true;
    if (g) { $("folderGoalPanel").hidden = false; showGoalActive(g); }
    else { $("folderGoalPanel").hidden = true; }
  }
  function openGoalSetup() {
    const g = getGoal(curFid());
    $("folderGoalPanel").hidden = false;
    $("goalActive").hidden = true;
    $("goalSetup").hidden = false;
    $("goalWords").value = g ? g.target : 50000;
    $("goalDays").value = g ? g.days : 30;
  }
  function showGoalActive(g) {
    $("goalSetup").hidden = true;
    $("goalActive").hidden = false;
    const total = g.lastTotal || 0;
    const pct = g.target > 0 ? Math.min(100, Math.round((total / g.target) * 100)) : 0;
    $("goalBarFill").style.width = pct + "%";
    $("goalTitle").textContent = `เป้า ${g.target.toLocaleString()} คำ`;
    let meta = `เขียนแล้ว ${total.toLocaleString()} / ${g.target.toLocaleString()} คำ (${pct}%)`;
    if (total >= g.target) meta += " · บรรลุเป้าแล้ว 🎉";
    if (g.created && g.days) {
      const dl = new Date(g.created + "T00:00:00"); dl.setDate(dl.getDate() + g.days);
      const t0 = new Date(); t0.setHours(0, 0, 0, 0);
      const left = Math.ceil((dl - t0) / 86400000);
      meta += " · " + (left > 0 ? `เหลือ ${left} วัน` : "หมดเวลาแล้ว");
    }
    if (g.lastCounted) meta += ` · นับล่าสุด ${g.lastCounted}`;
    else meta += " · ยังไม่ได้นับ (กดนับคำใหม่)";
    $("goalMeta").textContent = meta;
  }
  // นับคำรวมของไฟล์ Doc ในโฟลเดอร์ปัจจุบัน (เฉพาะชั้นนี้ ไม่รวมโฟลเดอร์ย่อย)
  async function computeGoalProgress() {
    const fid = curFid();
    const g = getGoal(fid);
    if (!g) return;
    const docs = lastChildren.docs || [];
    $("goalActive").hidden = false; $("goalSetup").hidden = true;
    let total = 0;
    for (let i = 0; i < docs.length; i++) {
      $("goalMeta").textContent = `กำลังนับคำ ${i + 1}/${docs.length} ไฟล์...`;
      try { const { text } = await G().openDoc(docs[i].id); total += window.WT.countWords(text); }
      catch (e) { console.error("count doc:", e); }
    }
    g.lastTotal = total; g.lastCounted = window.WT.todayKey();
    setGoal(fid, g);
    showGoalActive(g);
  }

  if ($("folderGoalBtn")) $("folderGoalBtn").addEventListener("click", openGoalSetup);
  if ($("goalSetBtn")) $("goalSetBtn").addEventListener("click", async () => {
    const fid = curFid();
    const target = Math.max(1, parseInt($("goalWords").value, 10) || 0);
    const days = Math.max(1, parseInt($("goalDays").value, 10) || 0);
    const g = getGoal(fid) || {};
    g.target = target; g.days = days; g.created = g.created || window.WT.todayKey();
    setGoal(fid, g);
    await computeGoalProgress();
  });
  if ($("goalRecountBtn")) $("goalRecountBtn").addEventListener("click", computeGoalProgress);
  if ($("goalEditBtn")) $("goalEditBtn").addEventListener("click", openGoalSetup);
  if ($("goalDelBtn")) $("goalDelBtn").addEventListener("click", () => {
    delGoal(curFid());
    $("folderGoalPanel").hidden = true;
  });

  /* ---------- สร้างโฟลเดอร์/ไฟล์ใหม่ (dropdown menu) ---------- */
  if ($("addBtn")) $("addBtn").addEventListener("click", () => {
    $("createMenu").hidden = !$("createMenu").hidden;
  });
  // ปิดเมนูเมื่อคลิกที่อื่น
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#addBtn") && !e.target.closest("#createMenu")) {
      if ($("createMenu")) $("createMenu").hidden = true;
    }
    if (!e.target.closest(".item-menu-root")) closeAllItemMenus();
  });
  if ($("newFolderBtn")) $("newFolderBtn").addEventListener("click", () => {
    $("createMenu").hidden = true;
    startInlineCreate("folder");
  });
  if ($("newDocBtn")) $("newDocBtn").addEventListener("click", () => {
    $("createMenu").hidden = true;
    startInlineCreate("doc");
  });

  // คืนข้อความ "โฟลเดอร์ว่าง" ถ้าไม่มีรายการเหลือ
  function restoreEmptyHint() {
    if (!$("pickerList").querySelector(".pick-item")) {
      $("pickerHint").textContent = "โฟลเดอร์นี้ว่าง — กด “+ ใหม่” เพื่อสร้างไฟล์/โฟลเดอร์";
      $("pickerHint").style.display = "";
    }
  }
  // สร้างไฟล์/โฟลเดอร์แบบ inline (พิมพ์ชื่อในกล่อง text ในลิสต์เลย)
  function startInlineCreate(type) {
    $("pickerHint").style.display = "none";
    const row = document.createElement("div");
    row.className = "pick-item " + type + " editing";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "rename-input";
    input.placeholder = type === "folder" ? "ชื่อโฟลเดอร์ใหม่ แล้วกด Enter" : "ชื่อไฟล์ Doc ใหม่ แล้วกด Enter";
    row.appendChild(input);
    $("pickerList").prepend(row);
    input.focus();

    let done = false;
    const commit = async () => {
      if (done) return; done = true;
      const name = input.value.trim();
      if (!name) { row.remove(); restoreEmptyHint(); return; }
      try {
        if (type === "folder") {
          await G().createFolder(curFid(), name);
          renderBrowse();
        } else {
          const f = await G().createDoc(curFid(), name);
          pushNav({
            view: "write", root: pickerRoot,
            path: pathStack.map((p) => ({ id: p.id, name: p.name })),
            editing: true, fileId: f.id, fileName: f.name || name,
          });
        }
      } catch (e) { console.error(e); alert("สร้างไม่สำเร็จ: " + (e.message || e)); row.remove(); restoreEmptyHint(); }
    };
    const cancel = () => { if (done) return; done = true; row.remove(); restoreEmptyHint(); };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); commit(); }
      else if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
    });
    input.addEventListener("blur", commit);
  }

  // ปุ่มเลือกต้นทาง: ไดรฟ์ของฉัน / แชร์กับฉัน
  document.querySelectorAll("#folderFilter .seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      pickerRoot = b.dataset.filter === "shared" ? "shared" : "mine";
      pathStack = [rootEntry()];
      pushNav(writeBrowseState());
    });
  });

  // เปิดไฟล์มาเขียน (เรนเดอร์ ไม่ยุ่งกับ history)
  async function openFile(fileId, fileName) {
    const cur = pathStack[pathStack.length - 1];
    curFolderId = cur.id; curFolderName = cur.name;   // โฟลเดอร์ที่ไฟล์นี้อยู่ (ใช้กับสถิติ)
    try {
      $("pickerHint").textContent = "กำลังเปิดไฟล์...";
      $("pickerHint").style.display = "";
      const { text, ranges, aligns, normalized } = await G().openDoc(fileId);
      const baseline = await G().getTodayMinutes(fileId);
      curFileId = fileId; curFileName = fileName;
      window.WT.loadDoc(text, ranges, baseline, fileName, aligns);
      $("fileTitle").textContent = fileName;
      $("writePicker").hidden = true;
      $("writeEditor").hidden = false;
      if (normalized) window.WT.flushNow().catch((e) => console.error("clean save:", e));
    } catch (e) {
      console.error(e);
      $("pickerHint").textContent = "เปิดไฟล์ไม่สำเร็จ: " + (e.message || e);
    }
  }

  // ปุ่มกลับในแอป → ใช้ history.back() ให้สอดคล้องกับปุ่ม back ของเบราว์เซอร์
  $("backBtn").addEventListener("click", () => history.back());

  /* ---------- ลงทะเบียน save handler ของ editor ---------- */
  window.WT.registerSave(async ({ text, ranges, aligns, words, minutes }) => {
    if (!curFileId || !G() || !G().isConnected()) return;
    await G().saveDoc(curFileId, text, ranges, aligns);
    await G().upsertStat({
      date: window.WT.todayKey(),
      folderId: curFolderId,
      fileId: curFileId,
      fileName: curFileName,
      wordCount: words,
      minutes: minutes,
    });
  });

  /* ---------- Dashboard ---------- */
  const charts = {};

  // plugin: เขียนค่าบนหัวแท่งกราฟทุกแท่ง (ไม่ต้องเทียบแกน)
  const barValueLabel = {
    id: "barValueLabel",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const color = (getComputedStyle(document.documentElement).getPropertyValue("--text").trim()) || "#333";
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((bar, i) => {
          const v = ds.data[i];
          if (v == null || v === 0) return;
          ctx.save();
          ctx.fillStyle = color;
          ctx.font = "600 11px Sarabun, 'Segoe UI', sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(Number(v).toLocaleString(), bar.x, bar.y - 4);
          ctx.restore();
        });
      });
    },
  };
  if (window.Chart) Chart.register(barValueLabel);

  function makeChart(canvasId, label, color, yUnit) {
    const ctx = $(canvasId);
    return new Chart(ctx, {
      type: "bar",
      data: { labels: [], datasets: [{ label, data: [], backgroundColor: color, borderRadius: 6, maxBarThickness: 46 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 22 } },   // เผื่อที่ให้ตัวเลขบนหัวแท่งสูงสุด
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            title: { display: !!yUnit, text: yUnit || "", font: { size: 12 } },
          },
          x: { grid: { display: false } },
        },
      },
    });
  }
  function ensureCharts() {
    if (charts.daily) return;
    charts.daily = makeChart("chartDaily", "คำ/วัน", "#4c6ef5", "จำนวนคำ");
    charts.file = makeChart("chartFile", "คำ/ไฟล์", "#7048e8", "จำนวนคำ");
    charts.hours = makeChart("chartHours", "ชม./ไฟล์", "#f08c00", "ชั่วโมง");
  }

  function aggregate(rows) {
    const byFile = {};
    rows.forEach((r) => {
      if (!byFile[r.fileId]) byFile[r.fileId] = { name: r.fileName, byDate: {}, minutes: 0 };
      byFile[r.fileId].name = r.fileName;
      byFile[r.fileId].byDate[r.date] = r.wordCount;
      byFile[r.fileId].minutes += r.minutes;
    });

    const dailyDelta = {};
    Object.values(byFile).forEach((f) => {
      const dates = Object.keys(f.byDate).sort();
      let prev = 0;
      dates.forEach((d) => {
        const wc = f.byDate[d];
        const delta = wc - prev;
        dailyDelta[d] = (dailyDelta[d] || 0) + (delta > 0 ? delta : 0);
        prev = wc;
      });
    });
    const days = Object.keys(dailyDelta).sort();

    const files = Object.values(byFile);
    const wordsPerFile = files.map((f) => {
      const dates = Object.keys(f.byDate).sort();
      return { name: f.name, words: dates.length ? f.byDate[dates[dates.length - 1]] : 0 };
    });
    const hoursPerFile = files.map((f) => ({ name: f.name, hours: Math.round((f.minutes / 60) * 100) / 100 }));

    const dailyMinutes = {};
    rows.forEach((r) => { dailyMinutes[r.date] = (dailyMinutes[r.date] || 0) + (r.minutes || 0); });

    const totalWords = Object.values(dailyDelta).reduce((a, b) => a + b, 0);
    const totalMinutes = rows.reduce((a, r) => a + (r.minutes || 0), 0);

    return {
      daily: { labels: days, data: days.map((d) => dailyDelta[d]) },
      file: { labels: wordsPerFile.map((f) => f.name), data: wordsPerFile.map((f) => f.words) },
      hours: { labels: hoursPerFile.map((f) => f.name), data: hoursPerFile.map((f) => f.hours) },
      totalWords, totalMinutes, dailyDelta, dailyMinutes,
    };
  }

  /* ---------- Dashboard: เบราว์เซอร์โฟลเดอร์ (เหมือนหน้าเขียน) ---------- */
  let dashRoot = "mine", dashPath = [];
  let lastAgg = null, lastFolderName = "";
  let dashDetail = false;
  function dashRootEntry() {
    return dashRoot === "shared" ? { id: "shared", name: "แชร์กับฉัน" } : { id: "root", name: "ไดรฟ์ของฉัน" };
  }
  function initDashboard() {
    if (!G() || !G().isConnected()) {
      $("dashFolders").innerHTML = "";
      $("dashBreadcrumb").innerHTML = "";
      $("dashContent").hidden = true;
      $("dashEmpty").style.display = "";
      $("dashEmpty").textContent = "เชื่อมต่อ Google ก่อนเพื่อดูสถิติ";
      return;
    }
    if (!dashPath.length) dashPath = [dashRootEntry()];
    renderDashboard();
  }
  async function renderDashboard() {
    // breadcrumb
    $("dashBreadcrumb").innerHTML = dashPath
      .map((p, i) => `<span class="crumb" data-i="${i}">${esc(p.name)}</span>`)
      .join(' <span class="sep">›</span> ');
    $("dashBreadcrumb").querySelectorAll(".crumb").forEach((c) =>
      c.addEventListener("click", () => { dashPath = dashPath.slice(0, Number(c.dataset.i) + 1); renderDashboard(); }));
    document.querySelectorAll("#dashFilter .seg-btn").forEach((x) =>
      x.classList.toggle("active", x.dataset.filter === dashRoot));

    const cur = dashPath[dashPath.length - 1];

    // โฟลเดอร์ย่อย (กดเพื่อเจาะลึก)
    $("dashFolders").innerHTML = '<span class="muted-inline">กำลังโหลด...</span>';
    let children = { folders: [], docs: [] };
    try { children = await G().listChildren(cur.id); } catch (e) { console.error(e); }
    $("dashFolders").className = "dash-folders" + (dashDetail ? " detail" : "");
    $("dashFolders").innerHTML = children.folders.length
      ? children.folders.map((f) => `<button class="dash-folder" data-id="${esc(f.id)}" data-name="${esc(f.name)}">📁 ${esc(f.name)}</button>`).join("")
      : '<span class="muted-inline">— ไม่มีโฟลเดอร์ย่อย —</span>';
    $("dashFolders").querySelectorAll(".dash-folder").forEach((el) =>
      el.addEventListener("click", () => { dashPath.push({ id: el.dataset.id, name: el.dataset.name }); renderDashboard(); }));

    // สถิติของโฟลเดอร์ปัจจุบัน
    $("dashEmpty").style.display = "";
    $("dashEmpty").textContent = "กำลังโหลดสถิติ...";
    $("dashContent").hidden = true;
    try {
      const rows = await G().getFolderStats(cur.id);
      if (!rows.length) {
        $("dashEmpty").textContent = "โฟลเดอร์นี้ยังไม่มีข้อมูลการเขียน (ลองเข้าโฟลเดอร์ย่อย)";
        return;
      }
      const agg = aggregate(rows);
      lastAgg = agg; lastFolderName = cur.name;
      $("sumTime").textContent = fmtMinutes(agg.totalMinutes);
      $("sumWords").textContent = agg.totalWords.toLocaleString() + " คำ";
      $("sumSpeed").textContent = (agg.totalMinutes > 0 ? agg.totalWords / agg.totalMinutes : 0).toFixed(1) + " คำ/นาที";
      renderHeatmap(agg.dailyDelta, heatRange());
      // โชว์ container ก่อนสร้าง/อัปเดตกราฟ เพื่อให้ canvas มีขนาด (ไม่งั้นกราฟสูง 0)
      $("dashEmpty").style.display = "none";
      $("dashContent").hidden = false;
      ensureCharts();
      charts.daily.data.labels = agg.daily.labels.map((d) => d.slice(5));
      charts.daily.data.datasets[0].data = agg.daily.data; charts.daily.resize(); charts.daily.update();
      charts.file.data.labels = agg.file.labels; charts.file.data.datasets[0].data = agg.file.data; charts.file.resize(); charts.file.update();
      charts.hours.data.labels = agg.hours.labels; charts.hours.data.datasets[0].data = agg.hours.data; charts.hours.resize(); charts.hours.update();
    } catch (e) {
      console.error(e);
      $("dashEmpty").textContent = "โหลดสถิติไม่สำเร็จ: " + (e.message || e);
    }
  }
  document.querySelectorAll("#dashFilter .seg-btn").forEach((b) =>
    b.addEventListener("click", () => {
      dashRoot = b.dataset.filter === "shared" ? "shared" : "mine";
      dashPath = [dashRootEntry()];
      renderDashboard();
    }));
  // toggle มุมมองโฟลเดอร์ใน dashboard (ไอคอน ⇄ รายละเอียด)
  if ($("dashDetailBtn")) $("dashDetailBtn").addEventListener("click", () => {
    dashDetail = !dashDetail;
    $("dashDetailBtn").textContent = dashDetail ? "Icon" : "Detail";
    $("dashFolders").className = "dash-folders" + (dashDetail ? " detail" : "");
  });

  // heatmap รายวัน (สไตล์ GitHub) — rangeDays: จำนวนวันย้อนหลัง (0 = ทั้งหมดตั้งแต่วันแรกที่มีข้อมูล)
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function renderHeatmap(dailyDelta, rangeDays) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let start = new Date(today);
    if (rangeDays && rangeDays > 0) {
      start.setDate(today.getDate() - (rangeDays - 1));
    } else {
      // ทั้งหมด: เริ่มจากวันแรกสุดที่มีข้อมูล (ถ้าไม่มี ใช้ 16 สัปดาห์)
      const keys = Object.keys(dailyDelta).sort();
      if (keys.length) start = new Date(keys[0] + "T00:00:00");
      else start.setDate(today.getDate() - 111);
    }
    start.setDate(start.getDate() - start.getDay());  // ถอยไปวันอาทิตย์
    let html = "";
    const cursor = new Date(start);
    while (cursor <= today) {
      html += '<div class="hm-col">';
      for (let dow = 0; dow < 7; dow++) {
        if (cursor > today) { html += '<div class="hm hm-empty"></div>'; }
        else {
          const key = ymd(cursor);
          const w = dailyDelta[key] || 0;
          const b = w === 0 ? 0 : w < 100 ? 1 : w < 300 ? 2 : w < 600 ? 3 : 4;
          html += `<div class="hm hm-${b}" title="${key} · ${w} คำ"></div>`;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      html += "</div>";
    }
    $("heatmap").innerHTML = html;
  }

  // ค่าช่วงวันของ heatmap (อนุญาตค่า 0 = ทั้งหมด)
  function heatRange() {
    const v = parseInt($("heatmapRange").value, 10);
    return isNaN(v) ? 112 : v;
  }
  // เปลี่ยนช่วงเวลา heatmap
  if ($("heatmapRange")) $("heatmapRange").addEventListener("change", () => {
    if (lastAgg) renderHeatmap(lastAgg.dailyDelta, heatRange());
  });

  // export ข้อมูล heatmap เป็น CSV (date, words, minutes)
  if ($("heatmapExport")) $("heatmapExport").addEventListener("click", () => {
    if (!lastAgg) return;
    const dd = lastAgg.dailyDelta, dm = lastAgg.dailyMinutes || {};
    const dates = Array.from(new Set([...Object.keys(dd), ...Object.keys(dm)])).sort();
    let csv = "date,words,minutes\n";
    dates.forEach((d) => { csv += `${d},${dd[d] || 0},${Math.round(dm[d] || 0)}\n`; });
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `writing-stats-${(lastFolderName || "folder").replace(/[\\/:*?"<>|]/g, "_")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });

  /* ---------- แผงสถิติไฟล์นี้ ---------- */
  const fsCharts = {};
  function fmtMinutes(m) {
    m = Math.round(m);
    const h = Math.floor(m / 60), mm = m % 60;
    return h ? `${h} ชม. ${mm} นาที` : `${mm} นาที`;
  }
  function fsShowHint(msg) {
    $("fsHint").style.display = msg ? "" : "none";
    $("fsHint").textContent = msg || "";
    document.querySelector("#statsPanel .fs-summary").style.display = msg ? "none" : "";
    document.querySelector("#statsPanel .fs-charts").style.display = msg ? "none" : "";
  }
  async function toggleFileStats() {
    const panel = $("statsPanel");
    if (!panel.hidden) { panel.hidden = true; return; }
    $("sprintPanel").hidden = true;
    panel.hidden = false;
    if (!curFileId || !G() || !G().isConnected()) {
      fsShowHint("ยังไม่ได้เปิดไฟล์ หรือยังไม่ได้เชื่อม Google");
      return;
    }
    fsShowHint("กำลังโหลดสถิติ...");
    try {
      const rows = await G().getFileStats(curFileId);
      if (!rows.length) { fsShowHint("ยังไม่มีข้อมูลของไฟล์นี้ (เขียนแล้วกดบันทึกก่อน)"); return; }
      fsShowHint("");
      renderFileStats(rows);
    } catch (e) {
      console.error(e);
      fsShowHint("โหลดสถิติไม่สำเร็จ: " + (e.message || e));
    }
  }
  function renderFileStats(rows) {
    let prev = 0, totalWritten = 0, totalMin = 0;
    const labels = [], wordsData = [], timeData = [];
    rows.forEach((r) => {
      const delta = Math.max(0, r.wordCount - prev); prev = r.wordCount;
      labels.push(r.date.slice(5));
      wordsData.push(delta);
      timeData.push(Math.round(r.minutes));
      totalWritten += delta; totalMin += r.minutes;
    });
    const latest = rows[rows.length - 1].wordCount;
    const speed = totalMin > 0 ? totalWritten / totalMin : 0;
    $("fsTotalWords").textContent = latest.toLocaleString();
    $("fsTotalTime").textContent = fmtMinutes(totalMin);
    $("fsSpeed").textContent = speed.toFixed(1) + " คำ/นาที";
    if (!fsCharts.words) {
      fsCharts.words = makeChart("fsChartWords", "คำ/วัน", "#4c6ef5", "จำนวนคำ");
      fsCharts.time = makeChart("fsChartTime", "นาที/วัน", "#f08c00", "นาที");
    }
    fsCharts.words.data.labels = labels;
    fsCharts.words.data.datasets[0].data = wordsData;
    fsCharts.words.resize(); fsCharts.words.update();
    fsCharts.time.data.labels = labels;
    fsCharts.time.data.datasets[0].data = timeData;
    fsCharts.time.resize(); fsCharts.time.update();
  }
  if ($("fileStatsBtn")) $("fileStatsBtn").addEventListener("click", toggleFileStats);

  /* ---------- เมื่อเชื่อมต่อ Google สำเร็จ ---------- */
  window.UI = {
    onConnected: () => {
      dashPath = [];  // รีเซ็ตเบราว์เซอร์ dashboard
      // โหลดเป้าทั้งหมดจาก Sheet (ผูกบัญชี ข้ามเครื่อง) แล้ว refresh แผงเป้า
      if (G() && G().loadGoals) {
        G().loadGoals().then((m) => { goalsMap = m || {}; renderGoalForFolder(); })
          .catch((e) => console.error("loadGoals:", e));
      }
      if ($("view-write").classList.contains("active") && $("writeEditor").hidden) showWritePicker();
      if ($("view-dashboard").classList.contains("active")) initDashboard();
    },
  };

  /* ---------- init ---------- */
  showWritePicker();
})();
