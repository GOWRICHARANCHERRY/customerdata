const API_BASE = '/api';

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': 'Bearer ' + token } : {})
  };
}

async function apiRequest(url, options = {}) {
  const res = await fetch(API_BASE + url, {
    ...options,
    headers: { ...getAuthHeaders(), ...options.headers }
  });
  if (res.status === 401 || res.status === 403) {
    const data = await res.json().catch(() => ({}));
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html' + (data.timeRestricted ? '?timeRestricted=1' : '');
    throw new Error(data.error || 'Session expired');
  }
  if (options.raw) return res;
  return res.json();
}

let selectedRecords = { search: new Set(), all: new Set() };
let editingRecord = null;

document.addEventListener('DOMContentLoaded', function () {
  checkAuthentication();
  document.getElementById('dataEntryForm').addEventListener('submit', saveRecord);
  document.getElementById('editForm').addEventListener('submit', updateRecord);
  document.getElementById('billDate').value = new Date().toISOString().split('T')[0];
  generateBillNumber();
  loadAllRecords();
});

function checkAuthentication() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser'));
  const token = localStorage.getItem('token');

  if (!currentUser || !token) {
    window.location.href = 'login.html';
    return;
  }

  if (currentUser.locationRestricted && currentUser.lat && currentUser.lng && currentUser.radius) {
    startLocationWatch(currentUser.lat, currentUser.lng, currentUser.radius);
  }

  if (currentUser.role !== 'admin') {
    if (!currentUser.dataEntryAccess) {
      alert('Access Denied: You do not have permission to access the Data Entry system.');
      window.location.href = 'simple13.html';
      return;
    }
    if (!currentUser.excelAccess) {
      document.querySelector('.tab[onclick="showTab(\'excel\')"]').style.display = 'none';
    }
    if (!currentUser.auditAccess) {
      document.getElementById('auditTab').style.display = 'none';
    }
    if (!currentUser.analyticsAccess) {
      document.querySelector('.tab[onclick="showTab(\'analytics\')"]').style.display = 'none';
    }
  } else {
    document.getElementById('auditTab').style.display = 'block';
  }

  const roleText = currentUser.role === 'admin' ? ' (Admin)' : '';
  document.getElementById('currentUserName').textContent = 'Welcome, ' + currentUser.username + '!' + roleText;
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

function showTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  document.getElementById(tabName + 'Tab').classList.add('active');
  event.target.classList.add('active');

  if (tabName === 'all') loadAllRecords();
  if (tabName === 'audit') loadAuditLogs();
  if (tabName === 'analytics') {
    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    document.getElementById('analyticsDateFrom').value = thirtyDaysAgo.toISOString().split('T')[0];
    document.getElementById('analyticsDateTo').value = today.toISOString().split('T')[0];
    updateAnalytics();
  }
  clearSelection('search');
  clearSelection('all');
}

async function generateBillNumber() {
  try {
    const data = await apiRequest('/customers/next-bill-no');
    document.getElementById('billNo').value = data.nextBillNo;
  } catch (err) {
    document.getElementById('billNo').value = '1';
  }
}

function autoSetInterestRate() {
  const amount = parseFloat(document.getElementById('itemAmount').value);
  const rateInput = document.getElementById('interest');
  const itemType = document.getElementById('itemType').value;
  if (!amount || amount <= 0 || !itemType) return;
  if (itemType === 'Silver') rateInput.value = '3';
  else if (amount < 10000) rateInput.value = '2.5';
  else rateInput.value = '2';
}

function autoSetEditInterestRate() {
  const amount = parseFloat(document.getElementById('editItemAmount').value);
  const rateInput = document.getElementById('editInterest');
  const itemType = document.getElementById('editItemType').value;
  if (!amount || amount <= 0 || !itemType) return;
  if (itemType === 'Silver') rateInput.value = '3';
  else if (amount < 10000) rateInput.value = '2.5';
  else rateInput.value = '2';
}

function generateExtraMoneyFields() {
  const count = parseInt(document.getElementById('extraMoneyCount').value);
  const container = document.getElementById('extraMoneyContainer');
  container.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const section = document.createElement('div');
    section.className = 'extra-money-section';
    section.innerHTML = `
      <h4>${getOrdinal(i)} Extra Money Taken</h4>
      <div class="extra-money-fields">
        <div>
          <label>Amount:</label>
          <input type="number" id="extraAmount${i}" placeholder="Enter extra amount">
        </div>
        <div>
          <label>Start Date:</label>
          <input type="date" id="extraStartDate${i}">
        </div>
      </div>
    `;
    container.appendChild(section);
  }
}

function generateMoneyBackFields() {
  const count = parseInt(document.getElementById('moneyBackCount').value);
  const container = document.getElementById('moneyBackContainer');
  container.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const section = document.createElement('div');
    section.className = 'money-back-section';
    section.innerHTML = `
      <h4>${getOrdinal(i)} Money Given Back</h4>
      <div class="extra-money-fields">
        <div>
          <label>Amount:</label>
          <input type="number" id="backAmount${i}" placeholder="Enter repayment amount">
        </div>
        <div>
          <label>Payment Date:</label>
          <input type="date" id="backDate${i}">
        </div>
      </div>
    `;
    container.appendChild(section);
  }
}

function getOrdinal(num) {
  const ordinals = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
  return ordinals[num];
}

function generateEditExtraMoneyFields() {
  const count = parseInt(document.getElementById('editExtraMoneyCount').value);
  const container = document.getElementById('editExtraMoneyContainer');
  container.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const section = document.createElement('div');
    section.className = 'extra-money-section';
    section.innerHTML = `
      <h4>${getOrdinal(i)} Extra Money Taken</h4>
      <div class="extra-money-fields">
        <div>
          <label>Amount:</label>
          <input type="number" id="editExtraAmount${i}" placeholder="Enter extra amount">
        </div>
        <div>
          <label>Start Date:</label>
          <input type="date" id="editExtraStartDate${i}">
        </div>
      </div>
    `;
    container.appendChild(section);
  }
}

function generateEditMoneyBackFields() {
  const count = parseInt(document.getElementById('editMoneyBackCount').value);
  const container = document.getElementById('editMoneyBackContainer');
  container.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const section = document.createElement('div');
    section.className = 'money-back-section';
    section.innerHTML = `
      <h4>${getOrdinal(i)} Money Given Back</h4>
      <div class="extra-money-fields">
        <div>
          <label>Amount:</label>
          <input type="number" id="editBackAmount${i}" placeholder="Enter repayment amount">
        </div>
        <div>
          <label>Payment Date:</label>
          <input type="date" id="editBackDate${i}">
        </div>
      </div>
    `;
    container.appendChild(section);
  }
}

async function saveRecord(e) {
  e.preventDefault();

  const extraMoneyCount = parseInt(document.getElementById('extraMoneyCount').value) || 0;
  const moneyBackCount = parseInt(document.getElementById('moneyBackCount').value) || 0;

  const extraMoney = [];
  for (let i = 1; i <= extraMoneyCount; i++) {
    const amount = document.getElementById('extraAmount' + i)?.value;
    const date = document.getElementById('extraStartDate' + i)?.value;
    if (amount && date) {
      extraMoney.push({ amount: parseFloat(amount), startDate: date });
    }
  }

  const moneyBack = [];
  for (let i = 1; i <= moneyBackCount; i++) {
    const amount = document.getElementById('backAmount' + i)?.value;
    const date = document.getElementById('backDate' + i)?.value;
    if (amount && date) {
      moneyBack.push({ amount: parseFloat(amount), paymentDate: date });
    }
  }

  const record = {
    billNo: document.getElementById('billNo').value.trim(),
    billDate: document.getElementById('billDate').value,
    customerName: document.getElementById('customerName').value.trim(),
    phoneNumber: document.getElementById('phoneNumber').value.trim(),
    address: document.getElementById('address').value.trim(),
    itemName: document.getElementById('itemName').value.trim(),
    itemType: document.getElementById('itemType').value,
    itemAmount: parseFloat(document.getElementById('itemAmount').value),
    interest: parseFloat(document.getElementById('interest').value),
    weight: parseFloat(document.getElementById('weight').value),
    purity: document.getElementById('purity').value.trim(),
    notes: document.getElementById('notes').value.trim(),
    pendingMoney: parseFloat(document.getElementById('pendingMoney').value) || 0,
    extraMoneyCount,
    extraMoney,
    moneyBackCount,
    moneyBack
  };

  if (!record.billNo || !record.customerName || !record.address || !record.itemName ||
    !record.itemType || isNaN(record.itemAmount) || isNaN(record.interest) || isNaN(record.weight)) {
    showMessage('entryMessage', 'Please fill all required fields correctly.', 'error');
    return;
  }

  try {
    const result = await apiRequest('/customers', {
      method: 'POST',
      body: JSON.stringify(record)
    });
    if (result.error) {
      showMessage('entryMessage', result.error, 'error');
      return;
    }
    showMessage('entryMessage', 'Record saved successfully!', 'success');
    clearForm();
    generateBillNumber();
    loadAllRecords();
  } catch (err) {
    showMessage('entryMessage', 'Error saving record.', 'error');
  }
}

function clearForm() {
  document.getElementById('dataEntryForm').reset();
  document.getElementById('billDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('entryMessage').innerHTML = '';
  document.getElementById('extraMoneyContainer').innerHTML = '';
  document.getElementById('moneyBackContainer').innerHTML = '';
}

async function searchRecords() {
  const searchType = document.getElementById('searchType').value;
  const searchValue = document.getElementById('searchValue').value.trim().toLowerCase();
  const filterType = document.getElementById('searchFilterType').value;
  const filterStatus = document.getElementById('searchFilterStatus').value;
  const minAmount = document.getElementById('searchMinAmount').value;
  const maxAmount = document.getElementById('searchMaxAmount').value;
  const pendingFilter = document.getElementById('searchPendingFilter').value;

  try {
    const params = new URLSearchParams();
    if (searchValue) { params.append('searchType', searchType); params.append('searchValue', searchValue); }
    if (filterType) params.append('filterType', filterType);
    if (filterStatus) params.append('filterStatus', filterStatus);
    if (minAmount) params.append('minAmount', minAmount);
    if (maxAmount) params.append('maxAmount', maxAmount);
    if (pendingFilter) params.append('pendingFilter', pendingFilter);

    const records = await apiRequest('/customers?' + params.toString());
    displayRecords(records, 'searchResults', 'search');
  } catch (err) {
    document.getElementById('searchResults').innerHTML = '<div class="no-records">Error loading records.</div>';
  }
}

async function loadAllRecords() {
  const filterType = document.getElementById('allFilterType').value;
  const filterStatus = document.getElementById('allFilterStatus').value;
  const minAmount = document.getElementById('allMinAmount').value;
  const maxAmount = document.getElementById('allMaxAmount').value;
  const pendingFilter = document.getElementById('allPendingFilter').value;
  const sortBy = document.getElementById('sortBy').value;

  try {
    const params = new URLSearchParams();
    if (filterType) params.append('filterType', filterType);
    if (filterStatus) params.append('filterStatus', filterStatus);
    if (minAmount) params.append('minAmount', minAmount);
    if (maxAmount) params.append('maxAmount', maxAmount);
    if (pendingFilter) params.append('pendingFilter', pendingFilter);
    if (sortBy) params.append('sortBy', sortBy);

    const records = await apiRequest('/customers?' + params.toString());
    displayRecords(records, 'allRecords', 'all');
  } catch (err) {
    document.getElementById('allRecords').innerHTML = '<div class="no-records">Error loading records.</div>';
  }
}

function toggleRecordSelection(recordId, context) {
  if (selectedRecords[context].has(recordId)) {
    selectedRecords[context].delete(recordId);
  } else {
    selectedRecords[context].add(recordId);
  }
  updateSelectionUI(context);
}

function selectAll(context) {
  const checkboxes = document.querySelectorAll('#' + context + 'Records .record-checkbox');
  const selectAllCheckbox = document.getElementById(context + 'SelectAll');

  checkboxes.forEach(checkbox => {
    checkbox.checked = selectAllCheckbox.checked;
    const recordId = checkbox.dataset.recordId;
    if (selectAllCheckbox.checked) {
      selectedRecords[context].add(recordId);
    } else {
      selectedRecords[context].delete(recordId);
    }
  });
  updateSelectionUI(context);
}

function updateSelectionUI(context) {
  const selectedCount = selectedRecords[context].size;
  const bulkActions = document.getElementById(context + 'BulkActions');
  const selectedCountSpan = document.getElementById(context + 'SelectedCount');

  if (selectedCount > 0) {
    bulkActions.classList.add('show');
    selectedCountSpan.textContent = selectedCount + ' selected';
  } else {
    bulkActions.classList.remove('show');
    selectedCountSpan.textContent = '0 selected';
  }

  const selectAllCheckbox = document.getElementById(context + 'SelectAll');
  const totalCheckboxes = document.querySelectorAll('#' + context + 'Records .record-checkbox').length;

  if (selectAllCheckbox) {
    if (selectedCount === 0) {
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.checked = false;
    } else if (selectedCount === totalCheckboxes) {
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.checked = true;
    } else {
      selectAllCheckbox.indeterminate = true;
      selectAllCheckbox.checked = false;
    }
  }
}

function clearSelection(context) {
  selectedRecords[context].clear();
  const checkboxes = document.querySelectorAll('#' + context + 'Records .record-checkbox');
  checkboxes.forEach(checkbox => { checkbox.checked = false; });
  const selectAllCheckbox = document.getElementById(context + 'SelectAll');
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  }
  updateSelectionUI(context);
}

async function bulkMarkAsSold(context) {
  const selectedIds = Array.from(selectedRecords[context]);
  if (selectedIds.length === 0) { alert('Please select records to mark as sold.'); return; }
  if (!confirm('Are you sure you want to mark ' + selectedIds.length + ' record(s) as sold?')) return;

  try {
    await apiRequest('/customers/bulk-mark-sold', {
      method: 'POST',
      body: JSON.stringify({ ids: selectedIds })
    });
    clearSelection(context);
    if (context === 'all') loadAllRecords(); else searchRecords();
    alert(selectedIds.length + ' record(s) marked as sold successfully!');
  } catch (err) {
    alert('Error marking records as sold.');
  }
}

async function bulkDelete(context) {
  const selectedIds = Array.from(selectedRecords[context]);
  if (selectedIds.length === 0) { alert('Please select records to delete.'); return; }
  if (!confirm('Are you sure you want to delete ' + selectedIds.length + ' record(s)?\n\nThis action cannot be undone.')) return;

  try {
    await apiRequest('/customers/bulk-delete', {
      method: 'DELETE',
      body: JSON.stringify({ ids: selectedIds })
    });
    clearSelection(context);
    if (context === 'all') loadAllRecords(); else searchRecords();
    alert(selectedIds.length + ' record(s) deleted successfully!');
  } catch (err) {
    alert('Error deleting records.');
  }
}

function displayRecords(records, containerId, context) {
  const container = document.getElementById(containerId);
  selectedRecords[context].clear();

  let countHtml = '<div class="record-count">Total Records: ' + records.length + '</div>';

  if (records.length === 0) {
    container.innerHTML = countHtml + '<div class="no-records">No records found</div>';
    updateSelectionUI(context);
    return;
  }

  let html = countHtml + `
    <div class="select-all-container">
      <input type="checkbox" id="${context}SelectAll" onchange="selectAll('${context}')">
      <label for="${context}SelectAll" style="margin-left: 5px; font-weight: 600;">Select All</label>
    </div>
  `;

  records.forEach(record => {
    const isSold = record.status === 'sold';
    const soldBadge = isSold ? '<span class="sold-badge">SOLD</span>' : '';

    html += `
      <div class="record-card ${isSold ? 'sold' : ''}">
        <input type="checkbox" class="record-checkbox" data-record-id="${record.id}" onchange="toggleRecordSelection('${record.id}', '${context}')">
        <div class="record-header">
          <h4>Bill #${record.billNo} ${soldBadge}</h4>
          <div>
            <button class="btn btn-info" onclick="showRecordHistory('${record.id}')" title="View History">📊 History</button>
            <button class="btn btn-warning" onclick="editRecord('${record.id}')">Edit</button>
            ${!isSold ? `<button class="btn btn-success" onclick="markAsSold('${record.id}', '${context}')">Mark as Sold</button>` : ''}
            <button class="btn btn-danger" onclick="confirmDelete('${record.id}', '${context}')">Delete</button>
          </div>
        </div>
        <div class="record-details">
          <div class="record-detail"><strong>Customer Name</strong><span>${record.customerName}</span></div>
          <div class="record-detail"><strong>Phone Number</strong><span>${record.phoneNumber || 'N/A'}</span></div>
          <div class="record-detail"><strong>Bill Date</strong><span>${record.billDate ? new Date(record.billDate).toLocaleDateString() : 'N/A'}</span></div>
          <div class="record-detail"><strong>Item Name</strong><span>${record.itemName}</span></div>
          <div class="record-detail"><strong>Item Type</strong><span>${record.itemType}</span></div>
          <div class="record-detail"><strong>Amount</strong><span>₹${record.itemAmount.toLocaleString()}</span></div>
          <div class="record-detail"><strong>Interest</strong><span>${record.interest}%</span></div>
          <div class="record-detail"><strong>Weight</strong><span>${record.weight}g</span></div>
          ${record.purity ? `<div class="record-detail"><strong>Purity</strong><span>${record.purity}</span></div>` : ''}
          <div class="record-detail"><strong>Address</strong><span>${record.address}</span></div>
          ${record.extraMoneyCount > 0 ? `<div class="record-detail"><strong>Extra Money Taken</strong><span>${record.extraMoneyCount} time(s)</span></div>` : ''}
          ${record.moneyBackCount > 0 ? `<div class="record-detail"><strong>Money Given Back</strong><span>${record.moneyBackCount} time(s)</span></div>` : ''}
          ${record.pendingMoney > 0 ? `<div class="record-detail"><strong>Pending Money</strong><span style="color: #dc3545; font-weight: bold;">₹${record.pendingMoney.toLocaleString()}</span></div>` : ''}
          ${record.notes ? `<div class="record-detail"><strong>Notes</strong><span>${record.notes}</span></div>` : ''}
          ${isSold && record.soldAt ? `<div class="record-detail"><strong>Sold Date</strong><span>${new Date(record.soldAt).toLocaleDateString()}</span></div>` : ''}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  updateSelectionUI(context);
}

async function markAsSold(recordId, context) {
  if (!confirm('Are you sure you want to mark this record as sold?')) return;

  try {
    await apiRequest('/customers/' + recordId + '/mark-sold', { method: 'POST' });
    if (context === 'all') loadAllRecords(); else searchRecords();
    alert('Record marked as sold successfully!');
  } catch (err) {
    alert('Error marking record as sold.');
  }
}

async function exportToExcel() {
  try {
    const dateFrom = document.getElementById('exportDateFrom')?.value || '';
    const dateTo = document.getElementById('exportDateTo')?.value || '';
    let url = '/customers/export-excel';
    const params = [];
    if (dateFrom) params.push('dateFrom=' + encodeURIComponent(dateFrom));
    if (dateTo) params.push('dateTo=' + encodeURIComponent(dateTo));
    if (params.length) url += '?' + params.join('&');
    const res = await apiRequest(url, { raw: true });
    const blob = await res.blob();
    const now = new Date();
    const dateStr = now.getFullYear() + '-' +
      (now.getMonth() + 1).toString().padStart(2, '0') + '-' +
      now.getDate().toString().padStart(2, '0');
    const rangeStr = dateFrom && dateTo ? '_' + dateFrom + '_to_' + dateTo : '';
    const filename = 'backup_' + dateStr + rangeStr + '.xlsx';
    const urlObj = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = urlObj;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(urlObj);
    showMessage('excelMessage', 'Successfully exported to ' + filename, 'success');
  } catch (err) {
    showMessage('excelMessage', 'Error exporting to Excel.', 'error');
  }
}

async function importFromExcel() {
  const fileInput = document.getElementById('excelFile');
  const file = fileInput.files[0];
  if (!file) return;

  const progressDiv = document.getElementById('importProgress');
  progressDiv.style.display = 'block';
  progressDiv.innerHTML = 'Uploading Excel file...';

  try {
    const formData = new FormData();
    formData.append('file', file);

    const token = localStorage.getItem('token');
    const res = await fetch(API_BASE + '/customers/import-excel', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData
    });

    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('currentUser');
      window.location.href = 'login.html';
      return;
    }

    const data = await res.json();

    if (data.imported > 0) {
      let message = 'Successfully imported ' + data.imported + ' records.';
      if (data.errors > 0) message += ' ' + data.errors + ' errors occurred.';
      showMessage('excelMessage', message, 'success');
      loadAllRecords();
    } else {
      showMessage('excelMessage', 'No valid records found to import.', 'error');
    }

    if (data.errorDetails && data.errorDetails.length > 0) {
      progressDiv.innerHTML = '<strong>Import Errors:</strong><br>' + data.errorDetails.join('<br>');
    } else {
      progressDiv.style.display = 'none';
    }

    fileInput.value = '';
  } catch (err) {
    showMessage('excelMessage', 'Error reading Excel file: ' + err.message, 'error');
    progressDiv.style.display = 'none';
  }
}

async function downloadTemplate() {
  try {
    const res = await apiRequest('/customers/download-template', { raw: true });
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'customer_records_template.xlsx';
    a.click();
    window.URL.revokeObjectURL(url);
    showMessage('excelMessage', 'Template downloaded successfully!', 'success');
  } catch (err) {
    showMessage('excelMessage', 'Error downloading template.', 'error');
  }
}

async function editRecord(recordId) {
  try {
    const record = await apiRequest('/customers/' + recordId);
    if (!record || record.error) {
      alert('Record not found!');
      return;
    }

    editingRecord = record;

    document.getElementById('editId').value = record.id;
    document.getElementById('editBillNo').value = record.billNo;
    document.getElementById('editBillDate').value = record.billDate;
    document.getElementById('editCustomerName').value = record.customerName;
    document.getElementById('editPhoneNumber').value = record.phoneNumber || '';
    document.getElementById('editAddress').value = record.address;
    document.getElementById('editItemName').value = record.itemName;
    document.getElementById('editItemType').value = record.itemType;
    document.getElementById('editItemAmount').value = record.itemAmount;
    document.getElementById('editInterest').value = record.interest;
    document.getElementById('editWeight').value = record.weight;
    document.getElementById('editPurity').value = record.purity || '';
    document.getElementById('editPendingMoney').value = record.pendingMoney || 0;
    document.getElementById('editNotes').value = record.notes || '';
    document.getElementById('editExtraMoneyCount').value = record.extraMoneyCount || 0;
    document.getElementById('editMoneyBackCount').value = record.moneyBackCount || 0;

    generateEditExtraMoneyFields();
    generateEditMoneyBackFields();

    if (record.extraMoney) {
      record.extraMoney.forEach((extra, index) => {
        const amountField = document.getElementById('editExtraAmount' + (index + 1));
        const dateField = document.getElementById('editExtraStartDate' + (index + 1));
        if (amountField) amountField.value = extra.amount;
        if (dateField) dateField.value = extra.startDate;
      });
    }

    if (record.moneyBack) {
      record.moneyBack.forEach((back, index) => {
        const amountField = document.getElementById('editBackAmount' + (index + 1));
        const dateField = document.getElementById('editBackDate' + (index + 1));
        if (amountField) amountField.value = back.amount;
        if (dateField) dateField.value = back.paymentDate;
      });
    }

    document.getElementById('editModal').style.display = 'block';
  } catch (err) {
    alert('Error loading record.');
  }
}

async function updateRecord(e) {
  e.preventDefault();

  const recordId = document.getElementById('editId').value;
  const editExtraMoneyCount = parseInt(document.getElementById('editExtraMoneyCount').value) || 0;
  const editMoneyBackCount = parseInt(document.getElementById('editMoneyBackCount').value) || 0;

  const extraMoney = [];
  for (let i = 1; i <= editExtraMoneyCount; i++) {
    const amount = document.getElementById('editExtraAmount' + i)?.value;
    const date = document.getElementById('editExtraStartDate' + i)?.value;
    if (amount && date) extraMoney.push({ amount: parseFloat(amount), startDate: date });
  }

  const moneyBack = [];
  for (let i = 1; i <= editMoneyBackCount; i++) {
    const amount = document.getElementById('editBackAmount' + i)?.value;
    const date = document.getElementById('editBackDate' + i)?.value;
    if (amount && date) moneyBack.push({ amount: parseFloat(amount), paymentDate: date });
  }

  const updatedRecord = {
    billNo: document.getElementById('editBillNo').value.trim(),
    billDate: document.getElementById('editBillDate').value,
    customerName: document.getElementById('editCustomerName').value.trim(),
    phoneNumber: document.getElementById('editPhoneNumber').value.trim(),
    address: document.getElementById('editAddress').value.trim(),
    itemName: document.getElementById('editItemName').value.trim(),
    itemType: document.getElementById('editItemType').value,
    itemAmount: parseFloat(document.getElementById('editItemAmount').value),
    interest: parseFloat(document.getElementById('editInterest').value),
    weight: parseFloat(document.getElementById('editWeight').value),
    purity: document.getElementById('editPurity').value.trim(),
    notes: document.getElementById('editNotes').value.trim(),
    pendingMoney: parseFloat(document.getElementById('editPendingMoney').value) || 0,
    extraMoneyCount: editExtraMoneyCount,
    extraMoney,
    moneyBackCount: editMoneyBackCount,
    moneyBack,
    status: editingRecord.status || 'active'
  };

  if (!updatedRecord.billNo || !updatedRecord.customerName || !updatedRecord.address ||
    !updatedRecord.itemName || !updatedRecord.itemType || isNaN(updatedRecord.itemAmount) ||
    isNaN(updatedRecord.interest) || isNaN(updatedRecord.weight)) {
    alert('Please fill all required fields correctly.');
    return;
  }

  try {
    const result = await apiRequest('/customers/' + recordId, {
      method: 'PUT',
      body: JSON.stringify(updatedRecord)
    });

    if (result.error) {
      alert(result.error);
      return;
    }

    closeEditModal();
    loadAllRecords();
    if (document.getElementById('searchValue').value.trim()) searchRecords();
    alert('Record updated successfully!');
  } catch (err) {
    alert('Error updating record.');
  }
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
  editingRecord = null;
}

async function showRecordHistory(recordId) {
  try {
    const record = await apiRequest('/customers/' + recordId);
    const history = await apiRequest('/customers/' + recordId + '/history');

    if (!record || record.error) {
      alert('Record not found!');
      return;
    }

    const modal = document.getElementById('historyModal');
    const content = document.getElementById('historyContent');

    if (history.length === 0) {
      content.innerHTML = `
        <div class="no-records">
          <h3>${record.customerName} - Bill #${record.billNo}</h3>
          <p>No history available for this record.</p>
        </div>
      `;
    } else {
      let historyHtml = `
        <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 10px;">
          <h3>${record.customerName} - Bill #${record.billNo}</h3>
          <p><strong>Current Status:</strong> ${record.status === 'sold' ? '✅ Sold' : '🔄 Active'}</p>
        </div>
        <div class="timeline">
      `;

      history.forEach(entry => {
        const date = new Date(entry.timestamp);
        const actionIcon = { 'CREATE': '✨', 'UPDATE': '✏️', 'DELETE': '🗑️', 'MARK_SOLD': '💰' }[entry.action] || '📝';
        const actionColor = { 'CREATE': '#28a745', 'UPDATE': '#ffc107', 'DELETE': '#dc3545', 'MARK_SOLD': '#17a2b8' }[entry.action] || '#6c757d';

        historyHtml += `
          <div class="timeline-entry" style="border-left: 4px solid ${actionColor}; margin-bottom: 15px; padding: 15px; background: white; border-radius: 5px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <h4 style="margin: 0; color: ${actionColor};">${actionIcon} ${entry.action.replace('_', ' ')}</h4>
              <span style="font-size: 12px; color: #666;">${date.toLocaleString()}</span>
            </div>
            <p style="margin: 5px 0; color: #333;"><strong>User:</strong> ${entry.user} ${entry.userRole === 'admin' ? '(Admin)' : ''}</p>
            <p style="margin: 5px 0; color: #666;">${entry.details?.message || 'No details available'}</p>
        `;

        if (entry.details?.changes && entry.details.changes.length > 0) {
          historyHtml += `
            <div style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 5px;">
              <strong>Changes:</strong>
              <ul style="margin: 5px 0; padding-left: 20px;">
          `;
          entry.details.changes.forEach(change => {
            historyHtml += '<li style="font-size: 12px; color: #666;">' + change + '</li>';
          });
          historyHtml += '</ul></div>';
        }

        if (entry.details?.bulkOperation) {
          historyHtml += '<p style="font-size: 12px; color: #007bff; margin-top: 5px;">💼 Bulk operation (' + entry.details.totalRecords + ' records)</p>';
        }

        historyHtml += '</div>';
      });

      historyHtml += '</div>';
      content.innerHTML = historyHtml;
    }

    modal.style.display = 'block';
  } catch (err) {
    alert('Error loading history.');
  }
}

function closeHistoryModal() {
  document.getElementById('historyModal').style.display = 'none';
}

async function loadAuditLogs() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser'));
  if (!currentUser || currentUser.role !== 'admin') {
    document.getElementById('auditResults').innerHTML = '<div class="no-records">Access denied. Admin privileges required.</div>';
    return;
  }

  const actionFilter = document.getElementById('auditFilter').value;
  const userFilter = document.getElementById('auditUserFilter').value;
  const dateFilter = document.getElementById('auditDateFilter').value;

  try {
    const params = new URLSearchParams();
    if (actionFilter) params.append('actionFilter', actionFilter);
    if (userFilter) params.append('userFilter', userFilter);
    if (dateFilter) params.append('dateFilter', dateFilter);

    const auditLogs = await apiRequest('/customers/audit-logs/all?' + params.toString());
    displayAuditLogs(auditLogs);
    populateUserFilter();
  } catch (err) {
    document.getElementById('auditResults').innerHTML = '<div class="no-records">Error loading audit logs.</div>';
  }
}

function displayAuditLogs(auditLogs) {
  const container = document.getElementById('auditResults');

  if (auditLogs.length === 0) {
    container.innerHTML = '<div class="no-records">No audit logs found</div>';
    return;
  }

  let html = '<div class="record-count">Total Audit Entries: ' + auditLogs.length + '</div>';

  auditLogs.forEach(log => {
    const date = new Date(log.timestamp);
    const details = log.details || {};
    const actionIcon = { 'CREATE': '✨', 'UPDATE': '✏️', 'DELETE': '🗑️', 'MARK_SOLD': '💰' }[log.action] || '📝';
    const actionColor = { 'CREATE': '#28a745', 'UPDATE': '#ffc107', 'DELETE': '#dc3545', 'MARK_SOLD': '#17a2b8' }[log.action] || '#6c757d';

    html += `
      <div class="record-card" style="border-left: 4px solid ${actionColor};">
        <div class="record-header">
          <h4>${actionIcon} ${log.action.replace('_', ' ')} - ${log.customerName || 'Unknown'}</h4>
          <span style="font-size: 14px; color: #666;">${date.toLocaleString()}</span>
        </div>
        <div class="record-details">
          <div class="record-detail"><strong>User</strong><span>${log.user} ${log.userRole === 'admin' ? '(Admin)' : ''}</span></div>
          <div class="record-detail"><strong>Bill Number</strong><span>${log.billNumber || 'N/A'}</span></div>
          <div class="record-detail"><strong>Action</strong><span style="color: ${actionColor}; font-weight: bold;">${log.action.replace('_', ' ')}</span></div>
          <div class="record-detail"><strong>Details</strong><span>${details.message || 'No details available'}</span></div>
    `;

    if (details.changes && details.changes.length > 0) {
      html += `
        <div class="record-detail" style="grid-column: span 2;">
          <strong>Changes Made</strong>
          <div style="margin-top: 5px;">
      `;
      details.changes.forEach(change => {
        html += '<div style="font-size: 12px; color: #666; margin: 2px 0;">• ' + change + '</div>';
      });
      html += '</div></div>';
    }

    if (details.bulkOperation) {
      html += `
        <div class="record-detail"><strong>Operation Type</strong><span style="color: #007bff;">💼 Bulk Operation (${details.totalRecords} records)</span></div>
      `;
    }

    html += '</div></div>';
  });

  container.innerHTML = html;
}

async function populateUserFilter() {
  try {
    const users = await apiRequest('/customers/audit-logs/users');
    const userFilter = document.getElementById('auditUserFilter');
    const currentValue = userFilter.value;

    userFilter.innerHTML = '<option value="">All Users</option>';
    users.forEach(user => {
      userFilter.innerHTML += '<option value="' + user + '">' + user + '</option>';
    });

    userFilter.value = currentValue;
  } catch (err) {
  }
}

let mainChart = null;
let secondaryChart = null;

async function updateAnalytics() {
  const fromDate = document.getElementById('analyticsDateFrom').value;
  const toDate = document.getElementById('analyticsDateTo').value;
  const chartType = document.getElementById('analyticsType').value;

  try {
    const params = new URLSearchParams();
    if (fromDate) params.append('dateFrom', fromDate);
    if (toDate) params.append('dateTo', toDate);

    const records = await apiRequest('/customers?' + params.toString());
    updateSummaryCards(records);

    switch (chartType) {
      case 'sales':
        createDailySalesChart(records);
        createItemTypeChart(records);
        break;
      case 'itemType':
        createItemTypeChart(records);
        createStatusChart(records);
        break;
      case 'status':
        createStatusChart(records);
        createPendingChart(records);
        break;
      case 'pending':
        createPendingChart(records);
        createDailySalesChart(records);
        break;
      case 'monthly':
        createMonthlyChart(records);
        createItemTypeChart(records);
        break;
    }

    updateDetailedAnalytics(records);
  } catch (err) {
  }
}

function updateSummaryCards(records) {
  const container = document.getElementById('summaryCards');

  const totalRecords = records.length;
  const totalAmount = records.reduce((sum, record) => sum + (record.itemAmount || 0), 0);
  const soldRecords = records.filter(r => r.status === 'sold').length;
  const activeRecords = records.filter(r => r.status !== 'sold').length;
  const totalPending = records.reduce((sum, record) => sum + (record.pendingMoney || 0), 0);
  const avgAmount = totalRecords > 0 ? totalAmount / totalRecords : 0;

  container.innerHTML = `
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px; text-align: center;">
      <h3>📊 Total Records</h3>
      <p style="font-size: 24px; font-weight: bold; margin: 10px 0;">${totalRecords}</p>
    </div>
    <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 20px; border-radius: 10px; text-align: center;">
      <h3>💰 Total Amount</h3>
      <p style="font-size: 20px; font-weight: bold; margin: 10px 0;">₹${totalAmount.toLocaleString()}</p>
    </div>
    <div style="background: linear-gradient(135deg, #17a2b8 0%, #20c997 100%); color: white; padding: 20px; border-radius: 10px; text-align: center;">
      <h3>✅ Sold Items</h3>
      <p style="font-size: 24px; font-weight: bold; margin: 10px 0;">${soldRecords}</p>
    </div>
    <div style="background: linear-gradient(135deg, #ffc107 0%, #ff9800 100%); color: white; padding: 20px; border-radius: 10px; text-align: center;">
      <h3>🔄 Active Items</h3>
      <p style="font-size: 24px; font-weight: bold; margin: 10px 0;">${activeRecords}</p>
    </div>
    <div style="background: linear-gradient(135deg, #dc3545 0%, #e74c3c 100%); color: white; padding: 20px; border-radius: 10px; text-align: center;">
      <h3>⏳ Pending Money</h3>
      <p style="font-size: 20px; font-weight: bold; margin: 10px 0;">₹${totalPending.toLocaleString()}</p>
    </div>
    <div style="background: linear-gradient(135deg, #6f42c1 0%, #e83e8c 100%); color: white; padding: 20px; border-radius: 10px; text-align: center;">
      <h3>📈 Avg Amount</h3>
      <p style="font-size: 20px; font-weight: bold; margin: 10px 0;">₹${avgAmount.toLocaleString()}</p>
    </div>
  `;
}

function createDailySalesChart(records) {
  const salesByDate = {};
  records.forEach(record => {
    const date = record.billDate;
    if (date) {
      salesByDate[date] = (salesByDate[date] || 0) + (record.itemAmount || 0);
    }
  });

  const dates = Object.keys(salesByDate).sort();
  const amounts = dates.map(date => salesByDate[date]);

  if (mainChart) mainChart.destroy();

  const ctx = document.getElementById('mainChart').getContext('2d');
  mainChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: 'Daily Sales (₹)',
        data: amounts,
        borderColor: '#667eea',
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        borderWidth: 2,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'Daily Sales Trend' }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function (value) { return '₹' + value.toLocaleString(); }
          }
        }
      }
    }
  });
}

function createItemTypeChart(records) {
  const typeCount = {};
  records.forEach(record => {
    const type = record.itemType || 'Unknown';
    typeCount[type] = (typeCount[type] || 0) + 1;
  });

  const labels = Object.keys(typeCount);
  const data = Object.values(typeCount);
  const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'];

  if (secondaryChart) secondaryChart.destroy();

  const ctx = document.getElementById('secondaryChart').getContext('2d');
  secondaryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'Item Type Distribution' },
        legend: { position: 'bottom' }
      }
    }
  });
}

function createStatusChart(records) {
  const statusCount = {
    'Active': records.filter(r => r.status !== 'sold').length,
    'Sold': records.filter(r => r.status === 'sold').length
  };

  if (mainChart) mainChart.destroy();

  const ctx = document.getElementById('mainChart').getContext('2d');
  mainChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: Object.keys(statusCount),
      datasets: [{
        data: Object.values(statusCount),
        backgroundColor: ['#ffc107', '#28a745'],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'Item Status Distribution' }
      }
    }
  });
}

function createPendingChart(records) {
  const pendingRanges = {
    'No Pending': 0,
    '₹1-1000': 0,
    '₹1001-5000': 0,
    '₹5001-10000': 0,
    '₹10000+': 0
  };

  records.forEach(record => {
    const pending = record.pendingMoney || 0;
    if (pending === 0) pendingRanges['No Pending']++;
    else if (pending <= 1000) pendingRanges['₹1-1000']++;
    else if (pending <= 5000) pendingRanges['₹1001-5000']++;
    else if (pending <= 10000) pendingRanges['₹5001-10000']++;
    else pendingRanges['₹10000+']++;
  });

  if (mainChart) mainChart.destroy();

  const ctx = document.getElementById('mainChart').getContext('2d');
  mainChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(pendingRanges),
      datasets: [{
        label: 'Number of Records',
        data: Object.values(pendingRanges),
        backgroundColor: ['#28a745', '#ffc107', '#fd7e14', '#dc3545', '#6f42c1'],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'Pending Money Distribution' }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

function createMonthlyChart(records) {
  const monthlyData = {};
  records.forEach(record => {
    if (record.billDate) {
      const month = record.billDate.substring(0, 7);
      monthlyData[month] = (monthlyData[month] || 0) + (record.itemAmount || 0);
    }
  });

  const months = Object.keys(monthlyData).sort();
  const amounts = months.map(month => monthlyData[month]);

  if (mainChart) mainChart.destroy();

  const ctx = document.getElementById('mainChart').getContext('2d');
  mainChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [{
        label: 'Monthly Revenue (₹)',
        data: amounts,
        backgroundColor: 'rgba(102, 126, 234, 0.6)',
        borderColor: '#667eea',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'Monthly Revenue' }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function (value) { return '₹' + value.toLocaleString(); }
          }
        }
      }
    }
  });
}

function updateDetailedAnalytics(records) {
  const container = document.getElementById('detailedAnalytics');

  const customerTotals = {};
  records.forEach(record => {
    const name = record.customerName;
    customerTotals[name] = (customerTotals[name] || 0) + (record.itemAmount || 0);
  });

  const topCustomers = Object.entries(customerTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const recentTransactions = records
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
      <div>
        <h4>🏆 Top 5 Customers by Amount</h4>
        <div style="margin-top: 10px;">
          ${topCustomers.map(([name, amount], index) => `
            <div style="display: flex; justify-content: space-between; padding: 8px; background: ${index % 2 === 0 ? '#f8f9fa' : 'white'}; border-radius: 5px; margin-bottom: 5px;">
              <span>${index + 1}. ${name}</span>
              <span style="font-weight: bold;">₹${amount.toLocaleString()}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div>
        <h4>🕒 Recent Transactions</h4>
        <div style="margin-top: 10px;">
          ${recentTransactions.map(record => `
            <div style="padding: 8px; background: #f8f9fa; border-radius: 5px; margin-bottom: 5px;">
              <div style="font-weight: bold;">${record.customerName}</div>
              <div style="font-size: 12px; color: #666;">${record.billNo} - ₹${(record.itemAmount || 0).toLocaleString()}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

async function confirmDelete(recordId, containerId) {
  if (confirm('Are you sure you want to delete this record?\n\nThis action cannot be undone.')) {
    await deleteRecord(recordId, containerId);
  }
}

async function deleteRecord(recordId, containerId) {
  try {
    await apiRequest('/customers/bulk-delete', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [recordId] })
    });
    alert('Record deleted successfully!');
    if (containerId === 'allRecords') loadAllRecords(); else searchRecords();
  } catch (err) {
    alert('Error deleting record.');
  }
}

function showMessage(containerId, message, type) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'message ' + type;
  div.textContent = message;
  container.appendChild(div);
  if (type === 'success') {
    setTimeout(() => { container.innerHTML = ''; }, 3000);
  }
}

document.getElementById('searchValue').addEventListener('keypress', function (e) {
  if (e.key === 'Enter') searchRecords();
});

window.onclick = function (event) {
  const editModal = document.getElementById('editModal');
  const historyModal = document.getElementById('historyModal');
  if (event.target === editModal) closeEditModal();
  else if (event.target === historyModal) closeHistoryModal();
};

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    closeEditModal();
    closeHistoryModal();
  }
});

let locationWatchId = null;

function startLocationWatch(targetLat, targetLng, maxRadius) {
  if (!navigator.geolocation) {
    alert('Geolocation not supported. Location access is required for this account.');
    forceLogout();
    return;
  }
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
  function onPosition(position) {
    const dist = calculateDistance(targetLat, targetLng, position.coords.latitude, position.coords.longitude);
    if (dist > maxRadius) {
      alert('You left the allowed location. Logging out.');
      forceLogout();
    }
  }
  function onError(error) {
    alert('Unable to verify location. Location access is required.');
    forceLogout();
  }
  locationWatchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    maximumAge: 30000,
    timeout: 10000
  });
}

function forceLogout() {
  if (locationWatchId !== null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}
