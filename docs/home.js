  // home.js (minimal) — updated to use presentStudents / addPresentStudent from fetch-students.js
  // Purpose: Fetch master list, scan RFID/name/ID via keyboard, and render attendance table.
  // Uses presentStudents (imported) as the single source of truth for displayed "attendance".

  import { presentStudents, addPresentStudent } from "./fetch-students.js";

  let apiKey = "";
  let sheetId = "";
  let sheetName = "";

  // DOM elements (expected to exist in the page)
  const outputDiv = document.getElementById("rfidOutput");
  const statusDiv = document.getElementById("status");
  const resultDiv = document.getElementById("result");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const sheetIdInput = document.getElementById("sheetIdInput");
  const sheetNameInput = document.getElementById("sheetNameInput");
  const startBtn = document.getElementById("startBtn");
  const rightPanel = document.getElementById("rightPanel");
  const attendanceContainer = document.getElementById("attendanceContainer");
  const exportBtn = document.getElementById("exportBtn");
  const studentID = document.getElementById("studentID");
  const addStudentBtn = document.getElementById("addStudentBtn");

  let buffer = "";
  let readyForNextScan = false;
  let firstScanDone = false;

  // in-memory lists
  let allStudents = [];   // master list loaded from sheet
  // presentStudents is imported and used directly for display and mutation via addPresentStudent()
  // Add these DOM bindings (place near other DOM element declarations)

  // Handler: find by ID (or RFID fallback), but store only studentId, studentName and year (RFID allowed blank).
  if (addStudentBtn) {
    addStudentBtn.addEventListener("click", () => {
      const idValue = studentID && studentID.value ? studentID.value.trim() : "";
      if (!idValue) {
        return;
      }

      if (!allStudents || allStudents.length === 0) {
        statusDiv.textContent = "Master list not loaded. Click Start first.";
        statusDiv.style.color = "orange";
        return;
      }

      // Find by studentId first; if not found, try RFID as fallback
      const match = allStudents.find(s =>
        (s.studentId && String(s.studentId).trim() === idValue) ||
        (s.rfid && String(s.rfid).trim() === idValue)
      );

      if (!match) {
        statusDiv.textContent = `❌ No student found for ID: ${escapeHtml(idValue)}`;
        statusDiv.style.color = "red";
        return;
      }

      const studentId = (match.studentId || "").toString().trim();
      const studentName = (match.studentName || "").toString().trim();
      const year = (match.year || "Unknown").toString().trim();

      // Deduplicate by studentId only (allow adding when RFID is blank)
      const already = presentStudents.some(a =>
        a.studentId && String(a.studentId).trim() === studentId
      );

      if (already) {
        statusDiv.textContent = `⚠️ ${escapeHtml(studentName || studentId)} is already present.`;
        statusDiv.style.color = "orange";
        renderAttendanceTables();
        return;
      }

      // Add via centralized helper but pass only id, name and year (RFID left blank)
      addPresentStudent({
        studentId,
        studentName,
        year,
        rfid: "" // explicitly keep RFID blank per your request
      });

      statusDiv.textContent = `✅ Added: ${escapeHtml(studentName || studentId)}`;
      statusDiv.style.color = "green";

      if (studentID) studentID.value = "";
      if (!firstScanDone) { rightPanel.style.display = "block"; firstScanDone = true; }
      renderAttendanceTables();
    });
  }
  // --- Start: fetch master list only ---
  startBtn.addEventListener("click", async () => {
    apiKey = (apiKeyInput && apiKeyInput.value || "").trim();
    sheetId = (sheetIdInput && sheetIdInput.value || "").trim();
    sheetName = (sheetNameInput && sheetNameInput.value || "").trim();

    if (!apiKey || !sheetId || !sheetName) {
      alert("Please provide API Key, Spreadsheet ID and Sheet Name first.");
      return;
    }

    statusDiv.textContent = "Fetching master list...";
    statusDiv.style.color = "orange";
    try {
      await fetchAllSheetData();
      statusDiv.textContent = `Master list loaded (${allStudents.length} rows). Ready for scanning.`;
      statusDiv.style.color = "green";
      readyForNextScan = true;
    } catch (err) {
      statusDiv.textContent = "Failed to fetch master list.";
      statusDiv.style.color = "red";
      console.error(err);
    }
  });

  // --- Fetch master list from Google Sheets (simple range A1:ZZ10000) ---
  async function fetchAllSheetData() {
    const range = `${sheetName}!A1:ZZ10000`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || res.statusText || "Sheets API error");
    }
    const rows = Array.isArray(data.values) ? data.values : [];
    if (rows.length === 0) { allStudents = []; return; }

    // detect headers
    const headers = rows[0].map(h => (h || "").toString().trim());
    const studentIdIndex = headers.findIndex(h => /student.?id|^id$/i.test(h));
    const studentNameIndex = headers.findIndex(h => /student.?name|^name$/i.test(h));
    const yearIndex = headers.findIndex(h => /year.?level|year/i.test(h));
    const rfidIndex = headers.findIndex(h => /rfid/i.test(h));

    const fetched = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const studentId = studentIdIndex >= 0 ? (row[studentIdIndex] || "").toString() : "";
      const studentName = studentNameIndex >= 0 ? (row[studentNameIndex] || "").toString() : "";
      const year = yearIndex >= 0 ? (row[yearIndex] || "").toString() : "";
      const rfid = rfidIndex >= 0 ? (row[rfidIndex] || "").toString() : "";
      fetched.push({
        studentId: studentId || "",
        studentName: studentName || "",
        year: year || "",
        rfid: rfid || ""
      });
    }
    allStudents = fetched;
  }


  // --- handleScan: accept single or multi-token input (names prioritized), add matches to presentStudents ---
  // Matching priority: studentName (case-insensitive exact) -> studentId -> rfid.
  async function handleScan(tag) {
    // tag can contain multiple tokens (comma/space/semicolon separated). Normalize input.
    const raw = (tag || "").toString().trim();
    if (!raw) {
      statusDiv.textContent = "Enter a Name/ID or scan a tag.";
      statusDiv.style.color = "orange";
      return false;
    }

    // Ensure master list is loaded
    if (!allStudents || allStudents.length === 0) {
      apiKey = (apiKeyInput && apiKeyInput.value || "").trim();
      sheetId = (sheetIdInput && sheetIdInput.value || "").trim();
      sheetName = (sheetNameInput && sheetNameInput.value || "").trim();
      if (!apiKey || !sheetId || !sheetName) {
        statusDiv.textContent = "Master list not loaded. Press Start first or provide credentials.";
        statusDiv.style.color = "orange";
        return false;
      }
      try {
        await fetchAllSheetData();
      } catch (err) {
        statusDiv.textContent = "Failed to fetch master list.";
        statusDiv.style.color = "red";
        console.error(err);
        return false;
      }
    }

    // split into tokens
    const tokens = raw.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean);

    const added = [];
    const notFound = [];
    const alreadyPresent = [];

    // normalizer for comparisons
    const normalize = s => (s || "").toString().trim().toLowerCase();

    for (const token of tokens) {
      const nToken = normalize(token);

      // 1) Try to match by studentName (case-insensitive exact)
      let match = allStudents.find(s => normalize(s.studentName) === nToken);

      // 2) If not matched by name, try studentId exact
      if (!match) match = allStudents.find(s => normalize(s.studentId) === nToken);

      // 3) If still not matched, try rfid exact
      if (!match) match = allStudents.find(s => normalize(s.rfid) === nToken);

      if (!match) {
        notFound.push(token);
        continue;
      }

      const studentId = match.studentId || match.rfid || "";
      const foundRfid = match.rfid || token;
      const studentName = match.studentName || "Unknown Name";

      // check if present already
      const isAlready = presentStudents.some(a =>
        normalize(a.studentName) === normalize(studentName) ||
        normalize(a.studentId) === normalize(studentId) ||
        normalize(a.rfid) === normalize(foundRfid)
      );

      if (isAlready) {
        alreadyPresent.push(studentName);
        continue;
      }

      // add via centralized helper
      addPresentStudent({
        studentId,
        studentName,
        year: match.year || "Unknown",
        rfid: foundRfid
      });
      // persist after adding
      added.push(studentName);
    }

    // If any were added, show table
    if (added.length > 0) {
      if (!firstScanDone) { rightPanel.style.display = "block"; firstScanDone = true; }
      renderAttendanceTables();
    }

    // Build feedback message
    const parts = [];
    if (added.length) parts.push(`Added: ${added.join(", ")}`);
    if (alreadyPresent.length) parts.push(`Already present: ${alreadyPresent.join(", ")}`);
    if (notFound.length) parts.push(`Not found: ${notFound.join(", ")}`);

    if (parts.length) {
      statusDiv.textContent = parts.join(" • ");
      statusDiv.style.color = added.length ? "green" : "orange";
      resultDiv.classList.remove("notfound");
      resultDiv.innerHTML = `<p>${escapeHtml(parts.join(" <br> "))}</p>`;
    } else {
      statusDiv.textContent = "No matches added.";
      statusDiv.style.color = "red";
      resultDiv.classList.add("notfound");
      resultDiv.innerHTML = `<p>No matching records for: <b>${escapeHtml(tokens.join(", "))}</b></p>`;
    }
  }

  // --- Keyboard capture: accumulate characters into buffer, on Enter treat as tag (single token expected) ---
  document.addEventListener("keydown", e => {
    if (!readyForNextScan) return;
    if (e.key === "Enter") {
      const tag = buffer.trim();
      buffer = "";
      if (tag) {
        handleScan(tag);
      }
    } else {
      if (e.key.length === 1) buffer += e.key;
    }
  });

  // --- Deduplicate presentStudents helper (if needed) ---
  function dedupePresentStudents(list) {
    const seen = new Set();
    const out = [];
    for (const a of list) {
      const key = (a.rfid && a.rfid !== "") ? `rfid:${a.rfid}` : `id:${a.studentId || ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(a);
      }
    }
    return out;
  }

  // --- resetScan helper ---
  function resetScan() {
    readyForNextScan = true;
    outputDiv.textContent = "Ready for next scan...";
  }



  // --- Render attendance grouped by year ---
  // Uses presentStudents (imported) as source of truth
  function renderAttendanceTables() {
    attendanceContainer.innerHTML = "";

    // Remove duplicates using studentId or RFID
    const cleanedStudents = dedupePresentStudents(presentStudents);

    // Group by year
    const grouped = {};
    cleanedStudents.forEach(a => {
      const year = a.year && a.year !== "" ? a.year : "Unknown";
      if (!grouped[year]) grouped[year] = [];
      grouped[year].push(a);
    });

    // Build UI
    for (const year in grouped) {
      const students = grouped[year];

      const title = document.createElement("h4");
      title.textContent = `Year Level: ${year}`;
      title.style.marginTop = "20px";
      attendanceContainer.appendChild(title);

      const table = document.createElement("table");
      table.style.width = "100%";
      table.style.borderCollapse = "collapse";
      table.style.marginBottom = "20px";

      const thead = document.createElement("thead");
      thead.innerHTML = `
        <tr>
          <th style="width:33%; padding:8px; border:1px solid #ccc">STUDENT ID</th>
          <th style="width:34%; padding:8px; border:1px solid #ccc">STUDENT NAME</th>
          <th style="width:33%; padding:8px; border:1px solid #ccc">YEAR LEVEL</th>
        </tr>`;
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      students.forEach(s => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td style="padding:8px;border:1px solid #eee">${escapeHtml(s.studentId || s.rfid || "")}</td>
          <td style="padding:8px;border:1px solid #eee">${escapeHtml(s.studentName || "")}</td>
          <td style="padding:8px;border:1px solid #eee">${escapeHtml(s.year || "")}</td>`;
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      attendanceContainer.appendChild(table);
    }
  }

  // --- Simple HTML escape ---
  function escapeHtml(str) {
    if (typeof str !== "string") return str;
    return str.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  const addFormWrapper = document.querySelector(".add-form");
  const showBtn = document.getElementById("show-form");
  if (showBtn && addFormWrapper) {
    // Improve responsiveness: use pointer/touch when available, add keyboard support and ARIA
    showBtn.setAttribute("role", "button");
    showBtn.setAttribute("aria-label", "Toggle add student form");
    showBtn.tabIndex = 0;
    showBtn.setAttribute("aria-expanded", "false");

    function setAddFormOpen(open) {
      const isOpen = typeof open === 'boolean' ? open : !addFormWrapper.classList.contains('open');
      addFormWrapper.classList.toggle('open', isOpen);
      addFormWrapper.style.display = isOpen ? 'flex' : 'none';
      showBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    const toggleEvent = (window.PointerEvent) ? 'pointerdown' : (('ontouchstart' in window) ? 'touchstart' : 'click');

    showBtn.addEventListener(toggleEvent, function (e) {
      if (e.type === 'touchstart' || e.type === 'pointerdown') e.preventDefault();
      setAddFormOpen();
    }, { passive: false });

    showBtn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        setAddFormOpen();
      }
    });

    document.addEventListener('click', (e) => {
      const isOpen = addFormWrapper.classList.contains('open');
      if (!isOpen) return;
      if (showBtn.contains(e.target) || addFormWrapper.contains(e.target)) return;
      setAddFormOpen(false);
    }, { passive: true });

    if (!addFormWrapper.classList.contains('open')) addFormWrapper.style.display = 'none';
  }

  // initialize ready state
  resetScan();

  // --- Export to CSV (uses presentStudents) ---
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (!presentStudents || presentStudents.length === 0) {
        return alert('No attendance data to export.');
      }

      // Deduplicate by studentId (preferred) or RFID
      const dedupeMap = new Map();
      for (const a of presentStudents) {
        const id = (a.studentId && String(a.studentId).trim()) || '';
        const rfid = (a.rfid && String(a.rfid).trim()) || '';
        const key = id ? `id:${id}` : `rfid:${rfid}`;
        if (!dedupeMap.has(key)) {
          dedupeMap.set(key, {
            studentId: id,
            studentName: (a.studentName || '').toString(),
            year: (a.year || '').toString(),
            rfid: rfid
          });
        }
      }
      const unique = Array.from(dedupeMap.values());

      const headers = ['Student ID','Student Name','Year Level','RFID'];
      const rows = unique.map(a => [a.studentId||'', a.studentName||'', a.year||'', a.rfid||'']);
      const csv = [headers, ...rows]
        .map(r => r.map(cell => `"${(cell||'').toString().replaceAll('"','""')}"`).join(','))
        .join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'attendance.csv';
      link.click();
      URL.revokeObjectURL(link.href);
    });
  }



