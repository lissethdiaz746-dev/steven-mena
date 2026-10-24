(() => {
  const STORAGE_KEY = 'stevenPay_v2_data';

  // FECHA ANCLA EXACTA: Viernes 30 de Octubre 2026
  const ANCHOR_DATE = new Date(2026, 9, 30);

  const moneyFormat = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
  const getTodayString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const sanitize = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Lista inmutable de Pagos Fijos
  const DEFAULT_PAYMENTS = [
    { id: 'salvador', name: 'Salvador Morales', category: 'Transferencia Davivienda', amount: 37.50 },
    { id: 'andrea', name: 'Andrea Rivera', category: 'Transferencia Davivienda', amount: 37.50 },
    { id: 'mayra', name: 'Mayra Morales', category: 'Transferencia Davivienda', amount: 41.00 }
  ];

  let state = {
    cycleOffset: 0,
    paymentStates: {},
    transactions: []
  };

  let activeFilter = 'todos';
  let searchQuery = '';

  function getCycleDetails(offset = 0) {
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - ANCHOR_DATE.getTime()) / (1000 * 3600 * 24));
    let cycleIndex = Math.floor(diffDays / 14) + offset;

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

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('panelStevenMenaIphone_v2');
      if (raw) {
        const saved = JSON.parse(raw);
        const data = saved.state || saved;
        if (data) {
          state.transactions = Array.isArray(data.transactions) ? data.transactions : [];
          state.paymentStates = (typeof data.paymentStates === 'object' && data.paymentStates !== null) ? data.paymentStates : {};
        }
      }
    } catch (e) {
      console.warn("Iniciando almacenamiento limpio...");
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch(e){}
    renderApp();
  }

  function renderPayments(cycleId) {
    const container = document.getElementById('paymentsList');
    if (!container) return;

    const cycleStatus = state.paymentStates[cycleId] || {};

    container.innerHTML = DEFAULT_PAYMENTS.map(p => {
      const status = cycleStatus[p.id] || 'pendiente';
      const isPaid = status === 'pagado';
      const badgeClass = isPaid ? 'sub-badge' : (status === 'programado' ? 'pill-info' : '');
      const statusLabel = isPaid ? '✓ Liquidado' : (status === 'programado' ? 'Programado' : 'Pendiente');

      return `
        <div class="pay-item ${isPaid ? 'is-paid' : ''}">
          <div class="pay-item-top">
            <div>
              <div class="pay-name">${sanitize(p.name)}</div>
              <small style="color:var(--text-muted);">${sanitize(p.category)}</small>
            </div>
            <div>
              <span class="money" style="font-weight:800; display:block; text-align:right;">${moneyFormat(p.amount)}</span>
              <span class="${badgeClass}" style="font-size:0.68rem;">${statusLabel}</span>
            </div>
          </div>
          <select data-pay-id="${p.id}" style="font-size:0.8rem; min-height:36px; margin-top:4px;">
            <option value="pendiente" ${status === 'pendiente' ? 'selected' : ''}>Marcar Pendiente</option>
            <option value="programado" ${status === 'programado' ? 'selected' : ''}>Programado en Davivienda</option>
            <option value="pagado" ${status === 'pagado' ? 'selected' : ''}>Pagado / Verificado</option>
          </select>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-pay-id]').forEach(select => {
      select.addEventListener('change', e => {
        const pId = select.dataset.payId;
        if (!state.paymentStates[cycleId]) state.paymentStates[cycleId] = {};
        state.paymentStates[cycleId][pId] = e.target.value;

        const p = DEFAULT_PAYMENTS.find(x => x.id === pId);
        state.transactions.push({
          id: String(Date.now()),
          type: 'estado',
          date: getTodayString(),
          name: p.name,
          amount: p.amount,
          cycleId,
          status: e.target.value
        });
        saveData();
      });
    });
  }

  function renderHistory() {
    let list = [...state.transactions];

    if (activeFilter !== 'todos') list = list.filter(t => t.type === activeFilter);
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      list = list.filter(t => (t.name && t.name.toLowerCase().includes(q)) || (t.note && t.note.toLowerCase().includes(q)));
    }

    list.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));

    const container = document.getElementById('historyList');
    if (!container) return;

    container.innerHTML = list.map(t => {
      const isInc = t.type === 'ingreso';
      const colorClass = isInc ? 'positive' : (t.type === 'gasto' ? 'negative' : '');
      const sign = isInc ? '+' : (t.type === 'gasto' ? '-' : '');

      return `
        <div class="history-card">
          <div>
            <div style="font-weight:700; font-size:0.88rem;">${sanitize(t.name || 'Ingreso')}</div>
            <small style="color:var(--text-muted); font-size:0.75rem;">${sanitize(t.date)} ${t.note ? '· ' + sanitize(t.note) : ''}</small>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="money ${colorClass}" style="font-weight:800;">${sign}${moneyFormat(t.amount)}</span>
            <button class="btn btn-secondary delete-btn" data-del="${t.id}" style="min-height:28px; width:28px; padding:0; border-radius:8px;">✕</button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('¿Eliminar registro?')) return;
        state.transactions = state.transactions.filter(t => String(t.id) !== String(btn.dataset.del));
        saveData();
      });
    });

    const countEl = document.getElementById('historyCount');
    if (countEl) countEl.textContent = `${list.length} registros`;

    const emptyEl = document.getElementById('historyEmpty');
    if (emptyEl) emptyEl.style.display = list.length ? 'none' : 'block';
  }

  function renderApp() {
    const cycle = getCycleDetails(state.cycleOffset);

    const labelEl = document.getElementById('cycleLabel');
    const datesEl = document.getElementById('cycleDates');
    if (labelEl) labelEl.textContent = cycle.label;
    if (datesEl) datesEl.textContent = cycle.rangeText;

    // --- CÁLCULO DE SALDO ACUMULADO GLOBAL ---
    const totalGlobalIncome = state.transactions
      .filter(t => t.type === 'ingreso')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const totalGlobalExpenses = state.transactions
      .filter(t => t.type === 'gasto')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    let totalGlobalPaidPayments = 0;
    Object.keys(state.paymentStates).forEach(cId => {
      const cStatus = state.paymentStates[cId];
      if (cStatus) {
        DEFAULT_PAYMENTS.forEach(p => {
          if (cStatus[p.id] === 'pagado') {
            totalGlobalPaidPayments += Number(p.amount);
          }
        });
      }
    });

    const globalAccumulatedBalance = totalGlobalIncome - totalGlobalExpenses - totalGlobalPaidPayments;
    const accBalEl = document.getElementById('totalAccumulatedBalance');
    if (accBalEl) accBalEl.textContent = moneyFormat(globalAccumulatedBalance);

    // --- CÁLCULOS DEL CICLO CATORCENAL ACTUAL ---
    const cycleTx = state.transactions.filter(t => t.cycleId === cycle.cycleId);
    const income = cycleTx.filter(t => t.type === 'ingreso').reduce((s, t) => s + Number(t.amount || 0), 0);
    const extras = cycleTx.filter(t => t.type === 'gasto').reduce((s, t) => s + Number(t.amount || 0), 0);

    const cycleStatus = state.paymentStates[cycle.cycleId] || {};
    const paid = DEFAULT_PAYMENTS.filter(p => cycleStatus[p.id] === 'pagado').reduce((s, p) => s + Number(p.amount), 0);
    const reserved = DEFAULT_PAYMENTS.filter(p => cycleStatus[p.id] !== 'pagado').reduce((s, p) => s + Number(p.amount), 0);
    const totalPlanned = DEFAULT_PAYMENTS.reduce((s, p) => s + Number(p.amount), 0);

    const incEl = document.getElementById('incomeTotal');
    const planEl = document.getElementById('plannedTotal');
    const extEl = document.getElementById('extraTotal');
    const resEl = document.getElementById('reservedTotal');

    if (incEl) incEl.textContent = moneyFormat(income);
    if (planEl) planEl.textContent = moneyFormat(totalPlanned);
    if (extEl) extEl.textContent = moneyFormat(extras);
    if (resEl) resEl.textContent = moneyFormat(reserved);

    const spent = paid + extras + reserved;
    let pct = income > 0 ? Math.min(100, Math.round((spent / income) * 100)) : 0;
    const bar = document.getElementById('healthBar');
    if (bar) {
      bar.style.width = `${pct}%`;
      bar.style.backgroundColor = pct > 90 ? 'var(--red)' : (pct > 70 ? 'var(--orange)' : 'var(--green)');
    }

    renderPayments(cycle.cycleId);
    renderHistory();
  }

  // Inicialización de Eventos al Cargar el DOM
  document.addEventListener('DOMContentLoaded', () => {
    loadData();

    const incDateInput = document.getElementById('incomeDate');
    const expDateInput = document.getElementById('expenseDate');
    if (incDateInput) incDateInput.value = getTodayString();
    if (expDateInput) expDateInput.value = getTodayString();

    const prevBtn = document.getElementById('prevCycleBtn');
    const nextBtn = document.getElementById('nextCycleBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => { state.cycleOffset--; saveData(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { state.cycleOffset++; saveData(); });

    document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.bottom-nav .nav-item').forEach(b => b.classList.remove('active'));

        const target = document.getElementById(btn.dataset.target);
        if (target) target.classList.add('active');
        btn.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    const incForm = document.getElementById('incomeForm');
    if (incForm) {
      incForm.addEventListener('submit', e => {
        e.preventDefault();
        const amountEl = document.getElementById('incomeAmount');
        const noteEl = document.getElementById('incomeNote');
        const amount = Number(amountEl.value);
        if (!(amount > 0)) return;

        const cycle = getCycleDetails(state.cycleOffset);
        state.transactions.push({
          id: String(Date.now()),
          type: 'ingreso',
          date: incDateInput.value || getTodayString(),
          amount,
          cycleId: cycle.cycleId,
          note: noteEl ? noteEl.value.trim() : ''
        });

        if (amountEl) amountEl.value = '';
        if (noteEl) noteEl.value = '';
        saveData();
      });
    }

    const expForm = document.getElementById('expenseForm');
    if (expForm) {
      expForm.addEventListener('submit', e => {
        e.preventDefault();
        const amountEl = document.getElementById('expenseAmount');
        const nameEl = document.getElementById('expenseName');
        const catEl = document.getElementById('expenseCategory');
        const amount = Number(amountEl.value);
        const name = nameEl.value.trim();
        const cat = catEl ? catEl.value : '';

        if (!(amount > 0) || !name) return;

        const cycle = getCycleDetails(state.cycleOffset);
        state.transactions.push({
          id: String(Date.now()),
          type: 'gasto',
          date: expDateInput.value || getTodayString(),
          name: `${cat} · ${name}`,
          amount,
          cycleId: cycle.cycleId
        });

        if (amountEl) amountEl.value = '';
        if (nameEl) nameEl.value = '';
        saveData();
      });
    }

    document.querySelectorAll('#filterTabs .filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#filterTabs .filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        renderHistory();
      });
    });

    const searchInput = document.getElementById('historySearch');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        searchQuery = e.target.value;
        renderHistory();
      });
    }

    const expBtn = document.getElementById('exportBtn');
    if (expBtn) {
      expBtn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify({ format: 'stevenPay-v2.1', state }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `respaldo-stevenpay-${getTodayString()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }

    const impBtn = document.getElementById('importBtn');
    const impFile = document.getElementById('importFile');
    if (impBtn && impFile) {
      impBtn.addEventListener('click', () => impFile.click());
      impFile.addEventListener('change', async e => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const obj = JSON.parse(await f.text());
          const data = obj.state || obj;
          if (data) {
            state.transactions = Array.isArray(data.transactions) ? data.transactions : [];
            state.paymentStates = data.paymentStates || {};
            saveData();
          }
        } catch (err) {
          alert('Archivo JSON no válido.');
        }
      });
    }

    renderApp();
  });
})();
