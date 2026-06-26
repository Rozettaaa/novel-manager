/* ============================================================
   app.js — Editor core
   - กล่องเขียน contenteditable + ตัวหนา
   - นับคำไทย realtime (Intl.Segmenter)
   - จับเวลาที่ใช้เขียน (active time)
   - ดาวน์โหลด .docx
   - เปิด API window.WT ให้ ui.js / google.js เรียก
   ============================================================ */

const editor = document.getElementById("editor");
const wordCountEl = document.getElementById("wordCount");
const charCountEl = document.getElementById("charCount");
const minuteCountEl = document.getElementById("minuteCount");
const saveStatus = document.getElementById("saveStatus");

/* ---------- วันที่ YYYY-MM-DD (เวลาท้องถิ่น) ---------- */
function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/* ---------- นับคำภาษาไทย ---------- */
let segmenter = null;
if (typeof Intl !== "undefined" && Intl.Segmenter) {
  segmenter = new Intl.Segmenter("th", { granularity: "word" });
}
function countWords(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return 0;
  if (segmenter) {
    let n = 0;
    for (const seg of segmenter.segment(clean)) if (seg.isWordLike) n++;
    return n;
  }
  const m = clean.match(/[฀-๿]+|[A-Za-z0-9]+/g);
  return m ? m.length : 0;
}

/* ---------- จับเวลาที่ใช้เขียนจริง ---------- */
const IDLE_MS = 30000;     // หยุดเกิน 30 วิ ถือว่าพัก
const TICK_MS = 10000;     // นับทุก 10 วิ
let baselineMinutes = 0;   // นาทีของไฟล์นี้ที่บันทึกไว้ก่อนหน้า (วันนี้)
let activeSeconds = 0;     // วินาทีที่พิมพ์จริงใน session นี้
let lastInputTs = 0;
let timerId = null;

function startTimer() {
  if (timerId) clearInterval(timerId);
  timerId = setInterval(() => {
    if (Date.now() - lastInputTs < IDLE_MS) {
      activeSeconds += TICK_MS / 1000;
      updateMinuteDisplay();
    }
  }, TICK_MS);
}
function minutesToday() {
  return baselineMinutes + activeSeconds / 60;
}
function updateMinuteDisplay() {
  if (minuteCountEl) minuteCountEl.textContent = Math.round(minutesToday());
}

/* ---------- นับคำ/ตัวอักษร ---------- */
function refreshCounts() {
  const text = editor.innerText || "";
  if (wordCountEl) wordCountEl.textContent = countWords(text).toLocaleString();
  if (charCountEl) charCountEl.textContent = text.replace(/\n/g, "").length.toLocaleString();
}

/* ---------- editor → {text, ranges} ---------- */
function isBoldNode(node) {
  let el = node.nodeType === 3 ? node.parentElement : node;
  while (el && el !== editor) {
    if (el.tagName === "B" || el.tagName === "STRONG") return true;
    const fw = el.style && el.style.fontWeight;
    if (fw === "bold" || parseInt(fw, 10) >= 600) return true;
    el = el.parentElement;
  }
  return false;
}
function blockAlign(el) {
  const ta = (el.style && el.style.textAlign) || "";
  if (ta === "center") return "center";
  if (el.getAttribute && el.getAttribute("align") === "center") return "center";
  return "left";
}
// คืน array ของบรรทัด แต่ละบรรทัด = { runs:[{text,bold}], align }
function parseEditor() {
  const lines = [];
  let current = [];
  let curAlign = "left";
  const pushLine = () => { lines.push({ runs: current, align: curAlign }); current = []; };
  function walk(node) {
    const kids = node.childNodes;
    for (let k = 0; k < kids.length; k++) {
      const child = kids[k];
      if (child.nodeType === 3) {
        if (child.nodeValue) current.push({ text: child.nodeValue, bold: isBoldNode(child) });
      } else if (child.nodeType === 1) {
        const tag = child.tagName;
        if (tag === "BR") {
          // ข้าม filler BR ที่เป็น child ตัวสุดท้าย (เบราว์เซอร์ใส่ไว้ให้บรรทัดว่างมองเห็น)
          // ถ้าไม่ข้าม จะนับซ้ำกับ pushLine ของ DIV → บรรทัดว่างทวีคูณทุกครั้งที่เซฟ
          if (k === kids.length - 1) continue;
          pushLine();
        } else if (tag === "DIV" || tag === "P") {
          if (current.length) pushLine();
          const prev = curAlign;
          curAlign = blockAlign(child);
          walk(child);
          pushLine();
          curAlign = prev;
        } else walk(child);
      }
    }
  }
  walk(editor);
  if (current.length) pushLine();
  return lines;
}
function editorToTextAndBold() {
  const lines = parseEditor();
  let text = "";
  const ranges = [];
  const aligns = [];        // align ต่อบรรทัด (ตรงกับ text.split('\n'))
  let emptyRun = 0;
  let first = true;
  for (const line of lines) {
    const runs = line.runs;
    if (runs.length === 0) {
      // กันพลาด: ห้ามบรรทัดว่างเกิน 2 บรรทัดติดกัน (กันไฟล์บวมหลุดโลก)
      if (++emptyRun > 2) continue;
    } else {
      emptyRun = 0;
    }
    if (!first) text += "\n";
    first = false;
    aligns.push(line.align || "left");
    for (const run of runs) {
      const start = text.length;
      text += run.text;
      if (run.bold) ranges.push([start, text.length]);
    }
  }
  return { text, ranges, aligns };
}

/* ---------- {text, ranges} → editor ---------- */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function setFromTextAndBold(text, ranges, aligns) {
  const boldAt = new Array(text.length).fill(false);
  (ranges || []).forEach(([s, e]) => {
    for (let i = s; i < e && i < text.length; i++) boldAt[i] = true;
  });
  const lines = text.split("\n");
  let pos = 0, html = "";
  lines.forEach((line, idx) => {
    const centered = aligns && aligns[idx] === "center";
    html += centered ? '<div style="text-align:center">' : "<div>";
    if (line.length === 0) html += "<br>";
    else {
      let i = 0;
      while (i < line.length) {
        const b = boldAt[pos + i];
        let j = i;
        while (j < line.length && boldAt[pos + j] === b) j++;
        const chunk = escapeHtml(line.slice(i, j));
        html += b ? "<b>" + chunk + "</b>" : chunk;
        i = j;
      }
    }
    html += "</div>";
    pos += line.length + 1;
  });
  editor.innerHTML = html;
  refreshCounts();
}

/* ---------- บันทึก (กดปุ่มเอง) ---------- */
let saveHandler = null;
let dirty = false;
let saving = false;

function setSaveStatus(msg, kind) {
  if (!saveStatus) return;
  saveStatus.textContent = msg;
  saveStatus.classList.toggle("saving", kind === "saving");
  saveStatus.classList.toggle("error", kind === "error");
  saveStatus.classList.toggle("dirty", kind === "dirty");
}
function markDirty() {
  dirty = true;
  if (!saving) setSaveStatus("● ยังไม่ได้บันทึก", "dirty");
}

async function doSave() {
  if (!saveHandler) { dirty = false; setSaveStatus("บันทึกแล้ว"); return; }
  if (saving) return;
  saving = true;
  setSaveStatus("กำลังบันทึก...", "saving");
  const { text, ranges, aligns } = editorToTextAndBold();
  try {
    await saveHandler({ text, ranges, aligns, words: countWords(editor.innerText || ""), minutes: minutesToday() });
    dirty = false;
    setSaveStatus("บันทึกแล้ว");
  } catch (e) {
    console.error("save error:", e);
    setSaveStatus("บันทึกไม่สำเร็จ — ลองกดบันทึกอีกครั้ง", "error");
  } finally {
    saving = false;
  }
}

/* ---------- ตัวหนา ---------- */
const boldBtn = document.getElementById("boldBtn");
if (boldBtn) {
  boldBtn.addEventListener("click", () => {
    editor.focus();
    document.execCommand("bold", false, null);
    updateBoldState();
  });
}
function updateBoldState() {
  const active = document.queryCommandState && document.queryCommandState("bold");
  if (boldBtn) boldBtn.classList.toggle("active", !!active);
  updateAlignState();
}

/* ---------- จัดกึ่งกลาง ---------- */
const centerBtn = document.getElementById("centerBtn");

// คืน block (div/p) ระดับบนสุดของ editor ที่อยู่ในช่วงที่เลือก/เคอร์เซอร์
function selectedBlocks() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  return Array.from(editor.children).filter(
    (c) => c.nodeType === 1 && (!range.intersectsNode || range.intersectsNode(c))
  );
}
function toggleCenter() {
  editor.focus();
  const blocks = selectedBlocks();
  if (!blocks.length) return;
  const allCentered = blocks.every((b) => b.style.textAlign === "center");
  blocks.forEach((b) => { b.style.textAlign = allCentered ? "" : "center"; });
  updateAlignState();
  markDirty();
}
function updateAlignState() {
  if (!centerBtn) return;
  const blocks = selectedBlocks();
  const centered = blocks.length && blocks.every((b) => b.style.textAlign === "center");
  centerBtn.classList.toggle("active", !!centered);
}
if (centerBtn) centerBtn.addEventListener("click", toggleCenter);

/* ล้างตัวหนาทั้งไฟล์ (กดเอง) — คง alignment ไว้ */
const clearBoldBtn = document.getElementById("clearBoldBtn");
if (clearBoldBtn) {
  clearBoldBtn.addEventListener("click", () => {
    const { text, aligns } = editorToTextAndBold();
    setFromTextAndBold(text, [], aligns);   // เขียนเนื้อหาเดิมกลับโดยไม่มีตัวหนา (จัดกลางคงเดิม)
    markDirty();
  });
}

/* ---------- ดาวน์โหลด .docx ---------- */
async function downloadDocx() {
  const { Document, Packer, Paragraph, TextRun } = window.docx;
  const lines = parseEditor();
  const paragraphs = lines.map((line) =>
    new Paragraph({
      alignment: line.align === "center" ? "center" : undefined,
      children: line.runs.length
        ? line.runs.map((r) => new TextRun({ text: r.text, bold: r.bold }))
        : [new TextRun({ text: "" })],
    })
  );
  if (!paragraphs.length) paragraphs.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (window.WT.currentFileName ? window.WT.currentFileName() : "writing") + ".docx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
const dlBtn = document.getElementById("downloadBtn");
if (dlBtn) dlBtn.addEventListener("click", downloadDocx);

/* ---------- ปุ่มบันทึก ---------- */
const saveBtn = document.getElementById("saveBtn");
if (saveBtn) saveBtn.addEventListener("click", () => doSave());

/* ---------- พับ/ขยาย sidebar ---------- */
const sidebarEl = document.getElementById("sidebar");
const collapseBtn = document.getElementById("collapseBtn");
if (sidebarEl && collapseBtn) {
  if (localStorage.getItem("wt_sidebar") === "collapsed") sidebarEl.classList.add("collapsed");
  collapseBtn.addEventListener("click", () => {
    sidebarEl.classList.toggle("collapsed");
    localStorage.setItem("wt_sidebar", sidebarEl.classList.contains("collapsed") ? "collapsed" : "open");
  });
}

/* ---------- เปลี่ยนธีมสี (dropdown ขอบมน) ---------- */
const THEME_LABELS = { default: "ค่าเริ่มต้น", wood: "ไม้/เบจอ่อน", dark: "มืด (Dark)", green: "เขียวคลีน" };
const themeBtn = document.getElementById("themeBtn");
const themeMenu = document.getElementById("themeMenu");
const themeBtnLabel = document.getElementById("themeBtnLabel");
function applyTheme(v) {
  if (v === "default") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", v);
  localStorage.setItem("wt_theme", v);
  if (themeBtnLabel) themeBtnLabel.textContent = THEME_LABELS[v] || v;
}
if (themeBtn && themeMenu) {
  applyTheme(localStorage.getItem("wt_theme") || "default");
  themeBtn.addEventListener("click", (e) => { e.stopPropagation(); themeMenu.hidden = !themeMenu.hidden; });
  themeMenu.querySelectorAll(".menu-item").forEach((mi) =>
    mi.addEventListener("click", () => { applyTheme(mi.dataset.theme); themeMenu.hidden = true; }));
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#themeBtn") && !e.target.closest("#themeMenu")) themeMenu.hidden = true;
  });
}

/* ---------- Sprint: ตั้งเป้าเวลา + จำนวนคำ ---------- */
const $id = (id) => document.getElementById(id);
let sprint = null;

function openSprintPanel() {
  if (sprint) return;                  // กำลัง sprint อยู่ (แถบลอยโชว์อยู่แล้ว)
  const p = $id("sprintPanel");
  if (!p) return;
  if (!p.hidden) { p.hidden = true; return; }
  if ($id("statsPanel")) $id("statsPanel").hidden = true;  // ปิดอีกแผง
  p.hidden = false;
  $id("sprintSummary").hidden = true;
  $id("sprintSetup").hidden = false;
}
function startSprint() {
  const min = Math.max(1, parseFloat($id("sprintMinutes").value) || 0);
  const target = Math.max(1, parseInt($id("sprintTarget").value, 10) || 0);
  sprint = {
    startWords: countWords(editor.innerText || ""),
    startTime: Date.now(),
    endTime: Date.now() + min * 60000,
    durationMin: min,
    target,
    tid: null,
  };
  $id("sprintTargetShow").textContent = target;
  $id("sprintPanel").hidden = true;       // ปิดแผงตั้งค่า
  $id("sprintSummary").hidden = true;
  $id("sprintActive").hidden = false;     // โชว์แถบจับเวลาลอยบนสุด
  sprint.tid = setInterval(tickSprint, 500);
  tickSprint();
}
function tickSprint() {
  if (!sprint) return;
  const written = countWords(editor.innerText || "") - sprint.startWords;
  $id("sprintLiveWords").textContent = written;
  const pct = Math.min(100, Math.max(0, (written / sprint.target) * 100));
  $id("sprintBarFill").style.width = pct + "%";
  const remain = sprint.endTime - Date.now();
  if (remain <= 0) { $id("sprintCountdown").textContent = "00:00"; finishSprint(false); return; }
  const s = Math.ceil(remain / 1000);
  $id("sprintCountdown").textContent =
    String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}
function finishSprint(early) {
  if (!sprint) return;
  clearInterval(sprint.tid);
  const elapsedMin = early ? Math.max(0.01, (Date.now() - sprint.startTime) / 60000) : sprint.durationMin;
  const written = countWords(editor.innerText || "") - sprint.startWords;
  const diff = written - sprint.target;
  const speed = written / elapsedMin;
  const cmp = diff >= 0 ? `มากกว่าเป้า ${diff} คำ ✅` : `น้อยกว่าเป้า ${Math.abs(diff)} คำ`;
  $id("sprintActive").hidden = true;            // ซ่อนแถบลอย
  $id("sprintPanel").hidden = false;            // เปิดแผงเพื่อแสดงสรุป
  $id("sprintSetup").hidden = true;
  const sum = $id("sprintSummary");
  sum.hidden = false;
  sum.innerHTML =
    `<h4>${early ? "หยุดก่อนเวลา" : "หมดเวลา! 🎉"}</h4>` +
    `<div>เขียนได้ <b>${written}</b> คำ (เป้า ${sprint.target}) → <b>${cmp}</b></div>` +
    `<div>เวลาใช้ไป <b>${elapsedMin.toFixed(1)}</b> นาที</div>` +
    `<div>ความเร็วเฉลี่ย <b>${speed.toFixed(1)}</b> คำ/นาที</div>` +
    `<button id="sprintAgainBtn" class="ghost-btn small">ตั้งใหม่</button>`;
  const again = $id("sprintAgainBtn");
  if (again) again.addEventListener("click", () => { sum.hidden = true; $id("sprintSetup").hidden = false; });
  sprint = null;
}
function cancelSprint() {
  if (sprint) { clearInterval(sprint.tid); sprint = null; }
  if ($id("sprintActive")) $id("sprintActive").hidden = true;
  if ($id("sprintSummary")) $id("sprintSummary").hidden = true;
  if ($id("sprintSetup")) $id("sprintSetup").hidden = false;
  if ($id("sprintPanel")) $id("sprintPanel").hidden = true;
}
if ($id("sprintBtn")) $id("sprintBtn").addEventListener("click", openSprintPanel);
if ($id("sprintStartBtn")) $id("sprintStartBtn").addEventListener("click", startSprint);
if ($id("sprintStopBtn")) $id("sprintStopBtn").addEventListener("click", () => finishSprint(true));
document.querySelectorAll(".ed-panel-close").forEach((b) =>
  b.addEventListener("click", () => { const p = $id(b.dataset.close); if (p) p.hidden = true; }));

/* ---------- events ---------- */
editor.addEventListener("input", () => {
  lastInputTs = Date.now();
  refreshCounts();
  markDirty();           // ไม่ autosave แล้ว แค่ทำเครื่องหมายว่ายังไม่บันทึก
});
editor.addEventListener("keyup", updateBoldState);
editor.addEventListener("mouseup", updateBoldState);

// Ctrl+S = บันทึก
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (!$writeEditorHidden()) doSave();
  }
});
function $writeEditorHidden() {
  const w = document.getElementById("writeEditor");
  return !w || w.hidden;
}

// เตือนก่อนปิดแท็บถ้ายังมีงานไม่ได้บันทึก
window.addEventListener("beforeunload", (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
});

/* ---------- public API ---------- */
let _currentFileName = "";
window.WT = {
  todayKey,
  editorToTextAndBold,
  setFromTextAndBold,
  getWords: () => countWords(editor.innerText || ""),
  countWords: (t) => countWords(t || ""),
  registerSave: (fn) => { saveHandler = fn; },
  flushNow: async () => { await doSave(); },
  cancelSprint: () => cancelSprint(),
  isDirty: () => dirty,
  currentFileName: () => _currentFileName,

  // เปิดไฟล์ใหม่: ใส่เนื้อหา + รีเซ็ตตัวจับเวลาด้วย baseline (นาทีที่เคยเขียนวันนี้)
  loadDoc: (text, ranges, baselineMin, fileName, aligns) => {
    cancelSprint();                                   // เปิดไฟล์ใหม่ → รีเซ็ต sprint
    if ($id("statsPanel")) $id("statsPanel").hidden = true;
    setFromTextAndBold(text || "", ranges || [], aligns || []);
    _currentFileName = fileName || "";
    baselineMinutes = baselineMin || 0;
    activeSeconds = 0;
    lastInputTs = Date.now();
    dirty = false;
    updateMinuteDisplay();
    startTimer();
    setSaveStatus("บันทึกแล้ว");
  },
};
