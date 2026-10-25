(() => {
  const STORAGE_KEY = 'stevenPay_v2_data';
  const SHEETS_CONFIG_KEY = 'stevenPay_v2_google_sheets_config';
  const SHEETS_AUTHORIZED_KEY = 'stevenPay_v2_google_sheets_authorized';
  const DEFAULT_SPREADSHEET_ID = '16sbj017GQurGqDbdB6D5L4uBcR49MHNnneIzKAVQJ2Q';
  const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
  const ANCHOR_DATE = new Date(2026, 9, 30); // Viernes 30 de octubre de 2026
  const DAY_MS = 24 * 60 * 60 * 1000;

  const moneyFormat = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
  const getTodayString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const sanitize = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalizeText = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

  const DEFAULT_PAYMENTS = [
    { id: 'salvador', name: 'Salvador Morales', category: 'Transferencia Davivienda', amount: 37.50 },
    { id: 'andrea', name: 'Andrea Rivera', category: 'Transferencia Davivienda', amount: 37.50 },
    { id: 'mayra', name: 'Mayra Morales', category: 'Transferencia Davivienda', amount: 41.00 }
  ];

  let state = { cycleOffset: 0, paymentStates: {}, transactions: [], bankTransactions: [] };
  let activeFilter = 'todos';
  let searchQuery = '';
  let sheetsConfig = { clientId: '', spreadsheetId: DEFAULT_SPREADSHEET_ID, sheetName: 'Hoja 1', lastSyncAt: '' };
  let accessToken = null; // Nunca se guarda el token de Google en localStorage.
  let tokenExpiresAt = 0;
  let syncInProgress = false;

  function getCycleDetails(offset = 0) {
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - ANCHOR_DATE.getTime()) / DAY_MS);
    const cycleIndex = Math.floor(diffDays / 14) + offset;
    const startDate = new Date(ANCHOR_DATE);
    startDate.setDate(ANCHOR_DATE.getDate() + (cycleIndex * 14));
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 13);
    const fmt = d => `${d.getDate()} ${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getMonth()]}`;
    const cycleId = `${startDate.getFullYear()}-${startDate.getMonth() + 1}-${startDate.getDate()}`;
    return {
      cycleId,
      label: offset === 0 ? 'CATORCENA ACTUAL' : (offset < 0 ? 'CATORCENA PASADA' : 'CATORCENA FUTURA'),
      rangeText: `${fmt(startDate)} - ${fmt(endDate)} ${endDate.getFullYear()}`
    };
  }

  function getCycleIdForDate(isoDate) {
    const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return getCycleDetails(0).cycleId;
    const movementDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const anchor = new Date(ANCHOR_DATE.getFullYear(), ANCHOR_DATE.getMonth(), ANCHOR_DATE.getDate());
    const days = Math.floor((movementDate.getTime() - anchor.getTime()) / DAY_MS);
    const index = Math.floor(days / 14);
    const start = new Date(anchor);
    start.setDate(anchor.getDate() + index * 14);
    return `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`;
  }

  function loadData() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.transactions)) {
        state = {
          cycleOffset: Number.isFinite(Number(saved.cycleOffset)) ? Number(saved.cycleOffset) : 0,
          paymentStates: saved.paymentStates || {},
          transactions: saved.transactions,
          bankTransactions: Array.isArray(saved.bankTransactions) ? saved.bankTransactions : []
        };
      }
    } catch (e) { /* Si el respaldo local no se puede leer, se inicia vacío. */ }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderApp();
  }

  function loadSheetsConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(SHEETS_CONFIG_KEY));
      if (saved && typeof saved === 'object') {
        sheetsConfig = {
          clientId: String(saved.clientId || ''),
          spreadsheetId: String(saved.spreadsheetId || DEFAULT_SPREADSHEET_ID),
          sheetName: String(saved.sheetName || 'Hoja 1'),
          lastSyncAt: String(saved.lastSyncAt || '')
        };
      }
    } catch (e) { /* Mantener configuración predeterminada. */ }
    document.getElementById('sheetsClientId').value = sheetsConfig.clientId;
    document.getElementById('sheetsSpreadsheetId').value = sheetsConfig.spreadsheetId;
    document.getElementById('sheetsTabName').value = sheetsConfig.sheetName;
    updateSyncStatusFromCache();
  }

  function saveSheetsConfigFromForm() {
    sheetsConfig.clientId = document.getElementById('sheetsClientId').value.trim();
    sheetsConfig.spreadsheetId = document.getElementById('sheetsSpreadsheetId').value.trim();
    sheetsConfig.sheetName = document.getElementById('sheetsTabName').value.trim();
    localStorage.setItem(SHEETS_CONFIG_KEY, JSON.stringify(sheetsConfig));
  }

  function setSyncStatus(message, tone = 'neutral') {
    const node = document.getElementById('bankSyncStatus');
    node.textContent = message;
    node.style.color = tone === 'success' ? 'var(--green)' : (tone === 'error' ? 'var(--red)' : 'var(--text-muted)');
    const dot = document.querySelector('.status-dot');
    const header = document.getElementById('headerSyncText');
    if (dot) {
      dot.style.background = tone === 'error' ? 'var(--red)' : (tone === 'success' ? 'var(--green)' : 'var(--orange)');
      dot.style.boxShadow = `0 0 8px ${tone === 'error' ? 'var(--red)' : (tone === 'success' ? 'var(--green)' : 'var(--orange)')}`;
    }
    if (header) header.textContent = tone === 'success' ? 'Davivienda sincronizado' : (tone === 'error' ? 'Revisar conexión' : 'Davivienda');
  }

  function updateSyncStatusFromCache() {
    const count = state.bankTransactions.length;
    const last = sheetsConfig.lastSyncAt ? new Date(sheetsConfig.lastSyncAt) : null;
    document.getElementById('bankSyncLastUpdated').textContent = last && !Number.isNaN(last.getTime())
      ? `Última sincronización: ${last.toLocaleString('es-SV')}`
      : '';
    if (count) setSyncStatus(`${count} movimiento(s) bancario(s) guardado(s) en este dispositivo. Pulsa «Conectar y sincronizar» para actualizar.`, 'neutral');
    else setSyncStatus('Configura tu OAuth Client ID y pulsa «Conectar y sincronizar».', 'neutral');
  }

  function getAllTransactions() {
    return [...state.transactions, ...(state.bankTransactions || [])];
  }

  function hasMatchingBankCharge(payment, cycleId) {
    const target = normalizeText(payment.name);
    return (state.bankTransactions || []).some(t => {
      if (t.cycleId !== cycleId || t.type !== 'gasto' || Math.abs(Number(t.amount) - Number(payment.amount)) > 0.01) return false;
      return normalizeText(t.name).includes(target);
    });
  }

  function renderPayments(cycleId) {
    const container = document.getElementById('paymentsList');
    const cycleStatus = state.paymentStates[cycleId] || {};
    container.innerHTML = DEFAULT_PAYMENTS.map(p => {
      const status = cycleStatus[p.id] || 'pendiente';
      const isPaid = status === 'pagado';
      const badgeClass = isPaid ? 'sub-badge' : (status === 'programado' ? 'pill-info' : '');
      const statusLabel = isPaid ? '✓ Liquidado' : (status === 'programado' ? 'Programado' : 'Pendiente');
      return `
        <div class="pay-item ${isPaid ? 'is-paid' : ''}">
          <div class="pay-item-top">
            <div><div class="pay-name">${sanitize(p.name)}</div><small style="color:var(--text-muted);">${sanitize(p.category)}</small></div>
            <div><span class="money" style="font-weight:800; display:block; text-align:right;">${moneyFormat(p.amount)}</span><span class="${badgeClass}" style="font-size:0.68rem;">${statusLabel}</span></div>
          </div>
          <select data-pay-id="${p.id}" aria-label="Estado de pago ${sanitize(p.name)}" style="font-size:0.8rem; min-height:36px; margin-top:4px;">
            <option value="pendiente" ${status === 'pendiente' ? 'selected' : ''}>Marcar Pendiente</option>
            <option value="programado" ${status === 'programado' ? 'selected' : ''}>Programado en Davivienda</option>
            <option value="pagado" ${status === 'pagado' ? 'selected' : ''}>Pagado / Verificado</option>
          </select>
        </div>`;
    }).join('');

    container.querySelectorAll('[data-pay-id]').forEach(select => {
      select.addEventListener('change', e => {
        const pId = select.dataset.payId;
        if (!state.paymentStates[cycleId]) state.paymentStates[cycleId] = {};
        state.paymentStates[cycleId][pId] = e.target.value;
        const p = DEFAULT_PAYMENTS.find(x => x.id === pId);
        state.transactions.push({ id: String(Date.now()), type: 'estado', date: getTodayString(), name: p.name, amount: p.amount, cycleId, status: e.target.value });
        saveData();
      });
    });
  }

  function txTimestamp(t) {
    if (Number.isFinite(Number(t.sortAt))) return Number(t.sortAt);
    const m = String(t.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    const idTime = Number(t.id);
    return Number.isFinite(idTime) ? idTime : 0;
  }

  function renderHistory() {
    let list = getAllTransactions();
    if (activeFilter !== 'todos') list = list.filter(t => t.type === activeFilter);
    if (searchQuery.trim() !== '') {
      const q = normalizeText(searchQuery);
      list = list.filter(t => normalizeText([t.name, t.note, t.category, t.confirmation, t.bankType].filter(Boolean).join(' ')).includes(q));
    }
    list.sort((a, b) => txTimestamp(b) - txTimestamp(a));

    const container = document.getElementById('historyList');
    container.innerHTML = list.map(t => {
      const isInc = t.type === 'ingreso';
      const isExpense = t.type === 'gasto';
      const colorClass = isInc ? 'positive' : (isExpense ? 'negative' : '');
      const sign = isInc ? '+' : (isExpense ? '-' : '');
      const title = t.name || (isInc ? 'Ingreso' : 'Movimiento');
      const dateLabel = t.displayDate || t.date || '';
      let detail = '';
      if (t.source === 'davivienda') {
        detail = `Davivienda${t.category ? ' · ' + t.category : ''}${t.confirmation ? ' · Conf. ' + t.confirmation : ''}`;
      } else if (t.note) detail = t.note;
      const deleteButton = t.source === 'davivienda' ? '<span class="pill-info" style="font-size:0.65rem; white-space:nowrap;">Banco</span>' : `<button class="btn btn-secondary delete-btn" data-del="${sanitize(t.id)}" aria-label="Eliminar ${sanitize(title)}" style="min-height:28px; width:28px; padding:0; border-radius:8px;">✕</button>`;
      return `
        <div class="history-card">
          <div style="min-width:0; padding-right:8px;">
            <div style="font-weight:700; font-size:0.88rem; overflow-wrap:anywhere;">${sanitize(title)}</div>
            <small style="color:var(--text-muted); font-size:0.75rem;">${sanitize(dateLabel)}${detail ? ' · ' + sanitize(detail) : ''}</small>
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
            <span class="money ${colorClass}" style="font-weight:800;">${sign}${moneyFormat(t.amount)}</span>
            ${deleteButton}
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('¿Eliminar registro?')) return;
        state.transactions = state.transactions.filter(t => String(t.id) !== btn.dataset.del);
        saveData();
      });
    });
    document.getElementById('historyCount').textContent = `${list.length} registros`;
    document.getElementById('historyEmpty').style.display = list.length ? 'none' : 'block';
  }

  function renderApp() {
    const cycle = getCycleDetails(state.cycleOffset);
    document.getElementById('cycleLabel').textContent = cycle.label;
    document.getElementById('cycleDates').textContent = cycle.rangeText;

    const cycleTx = getAllTransactions().filter(t => t.cycleId === cycle.cycleId);
    const income = cycleTx.filter(t => t.type === 'ingreso').reduce((s, t) => s + Number(t.amount || 0), 0);
    const extras = cycleTx.filter(t => t.type === 'gasto').reduce((s, t) => s + Number(t.amount || 0), 0);
    const cycleStatus = state.paymentStates[cycle.cycleId] || {};
    // Si una transferencia fija ya aparece en el extracto, no se resta otra vez del saldo estimado.
    const paid = DEFAULT_PAYMENTS.filter(p => cycleStatus[p.id] === 'pagado' && !hasMatchingBankCharge(p, cycle.cycleId)).reduce((s, p) => s + Number(p.amount), 0);
    const reserved = DEFAULT_PAYMENTS.filter(p => cycleStatus[p.id] !== 'pagado' && !hasMatchingBankCharge(p, cycle.cycleId)).reduce((s, p) => s + Number(p.amount), 0);
    const totalPlanned = DEFAULT_PAYMENTS.reduce((s, p) => s + Number(p.amount), 0);
    const balance = income - paid - extras - reserved;

    document.getElementById('balance').textContent = moneyFormat(balance);
    document.getElementById('incomeTotal').textContent = moneyFormat(income);
    document.getElementById('plannedTotal').textContent = moneyFormat(totalPlanned);
    document.getElementById('extraTotal').textContent = moneyFormat(extras);
    document.getElementById('reservedTotal').textContent = moneyFormat(reserved);
    const spent = paid + extras + reserved;
    const pct = income > 0 ? Math.min(100, Math.round((spent / income) * 100)) : 0;
    const bar = document.getElementById('healthBar');
    bar.style.width = `${pct}%`;
    bar.style.backgroundColor = pct > 90 ? 'var(--red)' : (pct > 70 ? 'var(--orange)' : 'var(--green)');
    renderPayments(cycle.cycleId);
    renderHistory();
  }

  // ---------- Google Sheets (OAuth, solo lectura) ----------
  function parseSheetDate(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const dt = new Date(Date.UTC(1899, 11, 30) + value * DAY_MS);
      return { dateISO: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`, displayDate: `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`, timestamp: dt.getTime() };
    }
    const s = String(value ?? '').trim();
    if (!s) return null;
    let y, mo, d, hour = 0, minute = 0, second = 0;
    let hasTime = false;
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
    const dmy = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
    if (iso) {
      y = Number(iso[1]); mo = Number(iso[2]); d = Number(iso[3]);
      if (iso[4] !== undefined) { hour = Number(iso[4]); minute = Number(iso[5]); second = Number(iso[6] || 0); hasTime = true; if (iso[7]) hour = iso[7].toUpperCase() === 'PM' ? (hour % 12) + 12 : (hour % 12); }
    } else if (dmy) {
      d = Number(dmy[1]); mo = Number(dmy[2]); y = Number(dmy[3]); if (y < 100) y += 2000;
      if (dmy[4] !== undefined) { hour = Number(dmy[4]); minute = Number(dmy[5]); second = Number(dmy[6] || 0); hasTime = true; if (dmy[7]) hour = dmy[7].toUpperCase() === 'PM' ? (hour % 12) + 12 : (hour % 12); }
    } else {
      const named = s.match(/(?:\w+,\s*)?(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i);
      if (!named) return null;
      const months = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7, agosto:8, septiembre:9, setiembre:9, octubre:10, noviembre:11, diciembre:12 };
      d = Number(named[1]); mo = months[normalizeText(named[2])]; y = Number(named[3]);
      if (!mo) return null;
    }
    const dateCheck = new Date(y, mo - 1, d, hour, minute, second);
    if (!y || !mo || !d || dateCheck.getFullYear() !== y || dateCheck.getMonth() !== mo - 1 || dateCheck.getDate() !== d) return null;
    const dateISO = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const displayDate = `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}${hasTime ? ` ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : ''}`;
    return { dateISO, displayDate, timestamp: dateCheck.getTime() };
  }

  function parseAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    let s = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
    if (!s) return NaN;
    if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
    else if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
    const amount = Number(s);
    return Number.isFinite(amount) ? amount : NaN;
  }

  function normalizeHeader(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function findHeaderIndex(headers, aliases) {
    const normalized = headers.map(normalizeHeader);
    return normalized.findIndex(h => aliases.includes(h));
  }

  function rowsToBankTransactions(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = values[0] || [];
    const col = {
      fecha: findHeaderIndex(headers, ['fecha', 'date']),
      tipo: findHeaderIndex(headers, ['tipo', 'type']),
      concepto: findHeaderIndex(headers, ['concepto', 'descripcion', 'description', 'comercio']),
      monto: findHeaderIndex(headers, ['monto', 'amount', 'importe']),
      confirmacion: findHeaderIndex(headers, ['confirmacion', 'numero_confirmacion', 'confirmation', 'referencia']),
      messageId: findHeaderIndex(headers, ['gmail_message_id', 'message_id', 'gmail_id']),
      categoria: findHeaderIndex(headers, ['categoria', 'category'])
    };
    const missing = ['fecha', 'tipo', 'concepto', 'monto', 'messageId'].filter(k => col[k] < 0);
    if (missing.length) throw new Error(`Faltan columnas en la primera fila de Google Sheets: ${missing.join(', ')}. Revisa los encabezados y vuelve a intentar.`);

    const deduped = new Map();
    values.slice(1).forEach((row, index) => {
      const get = key => col[key] >= 0 ? row[col[key]] : '';
      const gmailMessageId = String(get('messageId') ?? '').trim();
      const concept = String(get('concepto') ?? '').trim();
      const rawType = normalizeText(get('tipo'));
      const type = /^(abono|ingreso|deposito|dep[oó]sito)$/.test(rawType) ? 'ingreso' : (/^(cargo|gasto|debito|d[eé]bito|retiro|compra)$/.test(rawType) ? 'gasto' : '');
      const date = parseSheetDate(get('fecha'));
      const amount = parseAmount(get('monto'));
      // Evita importar filas de cabecera/rotas/avisos que no representan un movimiento real.
      if (!gmailMessageId || !date || !type || !concept || !Number.isFinite(amount) || amount < 0) return;
      const category = String(get('categoria') ?? '').trim();
      const confirmation = String(get('confirmacion') ?? '').trim();
      deduped.set(gmailMessageId, {
        id: `bank:${gmailMessageId}`,
        source: 'davivienda',
        gmailMessageId,
        bankType: rawType,
        type,
        date: date.dateISO,
        displayDate: date.displayDate,
        sortAt: date.timestamp,
        cycleId: getCycleIdForDate(date.dateISO),
        name: concept,
        amount,
        category,
        confirmation,
        note: category
      });
    });
    return Array.from(deduped.values()).sort((a, b) => b.sortAt - a.sortAt);
  }

  async function syncBankMovements(token) {
    if (syncInProgress) return;
    if (!sheetsConfig.spreadsheetId || !sheetsConfig.sheetName) {
      setSyncStatus('Completa el ID del documento y el nombre de la pestaña.', 'error');
      return;
    }
    syncInProgress = true;
    const button = document.getElementById('connectSheetsBtn');
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = '⏳ Sincronizando…';
    try {
      const range = `'${sheetsConfig.sheetName.replace(/'/g, "''")}'!A:G`;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetsConfig.spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) { accessToken = null; tokenExpiresAt = 0; }
        const msg = data?.error?.message || `Google Sheets respondió con error ${response.status}.`;
        throw new Error(response.status === 403 ? `${msg} Comprueba que autorizaste la cuenta correcta y que tiene acceso a la hoja.` : msg);
      }
      const bankTransactions = rowsToBankTransactions(data.values || []);
      state.bankTransactions = bankTransactions;
      sheetsConfig.lastSyncAt = new Date().toISOString();
      localStorage.setItem(SHEETS_CONFIG_KEY, JSON.stringify(sheetsConfig));
      saveData();
      document.getElementById('bankSyncLastUpdated').textContent = `Última sincronización: ${new Date(sheetsConfig.lastSyncAt).toLocaleString('es-SV')}`;
      setSyncStatus(`Sincronización correcta: ${bankTransactions.length} movimiento(s) de Davivienda cargado(s). Los registros se deduplican por ID de Gmail.`, 'success');
    } catch (err) {
      setSyncStatus(`No se pudo sincronizar. ${err.message || 'Revisa la configuración y vuelve a intentar.'}`, 'error');
    } finally {
      syncInProgress = false;
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function connectAndSync() {
    saveSheetsConfigFromForm();
    if (!sheetsConfig.clientId) {
      setSyncStatus('Primero crea un OAuth Client ID de tipo Web y pégalo aquí. Consulta LEEME_Integracion_Davivienda.txt dentro del ZIP.', 'error');
      return;
    }
    if (!sheetsConfig.spreadsheetId || !sheetsConfig.sheetName) {
      setSyncStatus('Completa el ID del documento y el nombre exacto de la pestaña.', 'error');
      return;
    }
    if (location.protocol === 'file:' || (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')) {
      setSyncStatus('Para conectar Google, abre Steven Pay desde una dirección HTTPS (o localhost para pruebas). No funciona abriendo index.html directamente como archivo.', 'error');
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      setSyncStatus('No se ha cargado Google Identity Services. Comprueba tu conexión a Internet y vuelve a cargar la página.', 'error');
      return;
    }
    if (accessToken && Date.now() < tokenExpiresAt - 30000) {
      syncBankMovements(accessToken);
      return;
    }
    try {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: sheetsConfig.clientId,
        scope: SHEETS_SCOPE,
        callback: response => {
          if (response.error || !response.access_token) {
            localStorage.removeItem(SHEETS_AUTHORIZED_KEY);
            setSyncStatus(`Google no autorizó la conexión${response.error ? `: ${response.error}` : '.'}`, 'error');
            return;
          }
          accessToken = response.access_token;
          tokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
          localStorage.setItem(SHEETS_AUTHORIZED_KEY, '1');
          syncBankMovements(accessToken);
        },
        error_callback: error => {
          setSyncStatus(`No se pudo abrir la autorización de Google: ${error?.type || 'revisa el navegador y los permisos'}.`, 'error');
        }
      });
      const previouslyAuthorized = localStorage.getItem(SHEETS_AUTHORIZED_KEY) === '1';
      tokenClient.requestAccessToken({ prompt: previouslyAuthorized ? '' : 'consent' });
    } catch (err) {
      setSyncStatus(`No se pudo iniciar la conexión con Google. ${err.message || ''}`, 'error');
    }
  }

  function tryAutomaticRefresh() {
    if (document.visibilityState !== 'visible' || !accessToken || syncInProgress) return;
    if (Date.now() < tokenExpiresAt - 30000) syncBankMovements(accessToken);
    else setSyncStatus('La sesión de lectura de Google caducó. Pulsa «Conectar y sincronizar» para actualizar.', 'neutral');
  }

  // Eventos e inicialización
  document.getElementById('incomeDate').value = getTodayString();
  document.getElementById('expenseDate').value = getTodayString();
  document.getElementById('prevCycleBtn').addEventListener('click', () => { state.cycleOffset--; saveData(); });
  document.getElementById('nextCycleBtn').addEventListener('click', () => { state.cycleOffset++; saveData(); });

  document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.bottom-nav .nav-item').forEach(b => b.classList.remove('active'));
      document.getElementById(btn.dataset.target).classList.add('active');
      btn.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  document.getElementById('incomeForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = Number(document.getElementById('incomeAmount').value);
    if (!(amount > 0)) return;
    const cycle = getCycleDetails(state.cycleOffset);
    state.transactions.push({ id: String(Date.now()), type: 'ingreso', date: document.getElementById('incomeDate').value, amount, cycleId: cycle.cycleId, note: document.getElementById('incomeNote').value.trim() });
    document.getElementById('incomeAmount').value = '';
    document.getElementById('incomeNote').value = '';
    saveData();
  });

  document.getElementById('expenseForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = Number(document.getElementById('expenseAmount').value);
    const name = document.getElementById('expenseName').value.trim();
    const cat = document.getElementById('expenseCategory').value;
    if (!(amount > 0) || !name) return;
    const cycle = getCycleDetails(state.cycleOffset);
    state.transactions.push({ id: String(Date.now()), type: 'gasto', date: document.getElementById('expenseDate').value, name: `${cat} · ${name}`, amount, cycleId: cycle.cycleId });
    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseName').value = '';
    saveData();
  });

  document.querySelectorAll('#filterTabs .filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#filterTabs .filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderHistory();
    });
  });
  document.getElementById('historySearch').addEventListener('input', e => { searchQuery = e.target.value; renderHistory(); });

  document.getElementById('connectSheetsBtn').addEventListener('click', connectAndSync);

  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ format: 'stevenPay-v2', state }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `respaldo-stevenpay-${getTodayString()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (!Array.isArray(obj.state?.transactions)) throw Error();
      state = {
        cycleOffset: Number.isFinite(Number(obj.state.cycleOffset)) ? Number(obj.state.cycleOffset) : 0,
        paymentStates: obj.state.paymentStates || {},
        transactions: obj.state.transactions,
        bankTransactions: Array.isArray(obj.state.bankTransactions) ? obj.state.bankTransactions : []
      };
      saveData();
      updateSyncStatusFromCache();
    } catch (err) { alert('Archivo JSON no válido.'); }
    e.target.value = '';
  });

  loadData();
  loadSheetsConfig();
  renderApp();
  // Actualiza la hoja mientras Steven Pay permanece abierto y el permiso actual siga vigente.
  window.setInterval(tryAutomaticRefresh, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', tryAutomaticRefresh);
})();
