/* ============================================================
   random.js — เมนู Random: สุ่มชื่อตัวละคร + คลังคำบรรยาย
   พอร์ตตรรกะจากฝั่ง Flask (app.py) มาเป็น client-side ทั้งหมด
   ใช้ข้อมูลจาก random-data.js (window.RANDOM_DATA) ไม่ต้องต่อ Google/backend
   ============================================================ */
(function () {
  const D = window.RANDOM_DATA || { names: {}, desc: {} };
  const $ = (id) => document.getElementById(id);

  // ตัวเลือกเพศ/บรรดาศักดิ์ (เรียงตามของเดิม)
  const GENDER_OPTIONS = [
    "ชาย", "หญิง", "สาวใช้", "บ่าวชาย", "ท่านอ๋อง", "ท่านหญิง", "องค์หญิง",
    "ท่านโหว", "ท่านกั๋วกง", "ท่านปั๋ว", "ตำหนัก", "เรือน", "หอ", "ศาลา",
    "ทะเลสาบ", "วัง", "รัชศก", "เมือง", "ตรอก", "ถนน", "วัด", "อำเภอ",
    "ชื่อรองชาย", "ชื่อเล่นหญิง",
  ];
  // บรรดาศักดิ์ที่ต้องมีครบ 3 คำเสมอ
  const ALWAYS_FULL = [
    "องค์หญิง", "ท่านหญิง", "ท่านโหว", "ท่านปั๋ว", "ท่านกั๋วกง", "ศาลา", "รัชศก",
    "หอ", "ตำหนัก", "เรือน", "วัง", "ทะเลสาบ", "เมือง", "วัด", "ตรอก", "อำเภอ", "ถนน",
  ];

  const pick = (a) => (a && a.length ? a[Math.floor(Math.random() * a.length)] : "");

  // ตรรกะสุ่มชื่อ (ตรงกับ generate_random_name ใน app.py)
  function genName(gender) {
    const d = D.names[gender];
    if (!d) return `ไม่พบข้อมูลสำหรับ '${gender}'`;
    const surname = pick(d.surnames), f1 = pick(d.first1), f2 = pick(d.first2);

    if (ALWAYS_FULL.includes(gender)) {
      if (!(surname && f1 && f2)) return `ข้อมูลของ '${gender}' ไม่สมบูรณ์ (ต้องมี 3 คำ)`;
      return `${surname} ${f1} ${f2}`;
    }
    if (gender === "ท่านอ๋อง") {
      if (!surname || !f2) return `ข้อมูลของ '${gender}' ไม่สมบูรณ์`;
      if (Math.random() < 0.5 && f1) return `${surname} ${f1} ${f2}`;
      return `${surname} ${f2}`;
    }
    if (!surname && !f1) return `ข้อมูลของ '${gender}' ไม่สมบูรณ์`;
    if (f2 && Math.random() < 0.5) return `${surname} ${f1} ${f2}`.trim();
    return `${surname} ${f1}`.trim();
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const old = btn.textContent;
      btn.textContent = "คัดลอกแล้ว ✓";
      setTimeout(() => { btn.textContent = old; }, 1200);
    } catch (e) {
      // fallback สำหรับเบราว์เซอร์เก่า
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e2) {}
      document.body.removeChild(ta);
      const old = btn.textContent;
      btn.textContent = "คัดลอกแล้ว ✓";
      setTimeout(() => { btn.textContent = old; }, 1200);
    }
  }

  /* ---------- แท็บ ---------- */
  function initTabs() {
    document.querySelectorAll(".rnd-tabs .seg-btn").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll(".rnd-tabs .seg-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        const t = b.dataset.rtab;
        $("rndNameTab").hidden = t !== "name";
        $("rndDescTab").hidden = t !== "desc";
      });
    });
  }

  /* ---------- สุ่มชื่อ ---------- */
  const history = [];
  function renderHistory() {
    const wrap = $("rndHistoryWrap");
    if (!history.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $("rndHistory").innerHTML = history.map((n, i) =>
      `<div class="rnd-history-item"><span></span><button class="ghost-btn small" data-i="${i}">คัดลอก</button></div>`
    ).join("");
    // ใส่ข้อความแบบ textContent กัน XSS + ผูกปุ่มคัดลอก
    $("rndHistory").querySelectorAll(".rnd-history-item").forEach((el, i) => {
      el.querySelector("span").textContent = history[i];
      el.querySelector("button").addEventListener("click", (e) => copyText(history[i], e.currentTarget));
    });
  }
  function initNameTab() {
    const sel = $("rndGender");
    sel.innerHTML = GENDER_OPTIONS
      .filter((g) => D.names[g])   // แสดงเฉพาะที่มีข้อมูล
      .map((g) => `<option value="${g}">${g}</option>`).join("");

    function roll() {
      const gender = sel.value;
      const name = genName(gender);
      $("rndResult").hidden = false;
      $("rndResultText").textContent = name;
      // เก็บประวัติเฉพาะผลที่เป็นชื่อจริง (ไม่ใช่ข้อความ error)
      if (!name.startsWith("ไม่พบ") && !name.startsWith("ข้อมูลของ")) {
        history.unshift(name);
        if (history.length > 10) history.pop();
        renderHistory();
      }
    }
    $("rndNameBtn").addEventListener("click", roll);
    $("rndResultCopy").addEventListener("click", (e) => copyText($("rndResultText").textContent, e.currentTarget));
    $("rndHistoryClear").addEventListener("click", () => { history.length = 0; renderHistory(); });
  }

  /* ---------- คลังคำบรรยาย ---------- */
  let currentItems = [];
  function renderDesc(items, category) {
    const list = $("rndDescList"), msg = $("rndDescMsg");
    const search = $("rndSearch").value.trim();
    list.innerHTML = "";
    if (!items || !items.length) {
      msg.textContent = search ? `ไม่พบคำบรรยายที่ตรงกับ "${search}"`
        : (category ? `ไม่พบข้อมูลในหมวด "${category}"` : "ไม่พบข้อมูล");
      return;
    }
    items.forEach((item) => {
      const box = document.createElement("div");
      box.className = "rnd-desc-box";
      const btn = document.createElement("button");
      btn.className = "primary-btn rnd-copy";
      btn.textContent = "คัดลอก";
      btn.addEventListener("click", () => copyText(item, btn));
      const txt = document.createElement("div");
      txt.className = "rnd-desc-text";
      txt.textContent = item;
      box.appendChild(btn); box.appendChild(txt); list.appendChild(box);
    });
    msg.textContent = search ? `พบ ${items.length} รายการ จากการค้นหา "${search}"`
      : `พบ ${items.length} รายการในหมวด "${category}"`;
  }
  function initDescTab() {
    const sel = $("rndCategory");
    const cats = Object.keys(D.desc).sort();
    sel.innerHTML = `<option value="">— เลือกหมวดหมู่ —</option>` +
      cats.map((c) => `<option value="${c}">${c}</option>`).join("");

    $("rndDescBtn").addEventListener("click", () => {
      const cat = sel.value;
      $("rndSearch").value = "";
      currentItems = [];
      if (!cat) { $("rndDescMsg").textContent = "กรุณาเลือกหมวดหมู่ก่อน"; $("rndDescList").innerHTML = ""; $("rndSearch").disabled = true; return; }
      currentItems = (D.desc[cat] || []).slice();
      $("rndSearch").disabled = false;
      renderDesc(currentItems, cat);
    });
    sel.addEventListener("change", () => { $("rndSearch").value = ""; });
    $("rndSearch").addEventListener("input", () => {
      if (!currentItems.length) return;
      const q = $("rndSearch").value.trim().toLowerCase();
      renderDesc(currentItems.filter((it) => it.toLowerCase().includes(q)), sel.value);
    });
  }

  /* ---------- init ---------- */
  function init() {
    if (!$("view-random")) return;
    initTabs(); initNameTab(); initDescTab();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
